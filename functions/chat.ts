import { OpenAI } from 'openai';
import { ConversationsHistoryResponse, ConversationsRepliesResponse, WebClient } from '@slack/web-api';
import { functionDefinitions, functions } from './github';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { LambdaEvent } from './api-invoker';
import { APIError } from 'openai/error';
import { getParameter, parameterNames } from './config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const ssmClient = new SSMClient();
const dynamodbClient = new DynamoDBClient();
const documentClient = DynamoDBDocumentClient.from(dynamodbClient);

async function callFunctions(chain: OpenAI.Beta.Threads.Runs.RequiredActionFunctionToolCall[], threadId: string, runId: string, openai: OpenAI) {
  const funcResults = chain.map(async (func) => {
    console.log('function calling:', func.function.name, func.function.arguments);
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      const resp = await functions[func.function.name].call(this, JSON.parse(func.function.arguments));
      const output = JSON.stringify(resp);
      console.log('response', output);
      return {
        tool_call_id: func.id,
        output
      };
    } catch (e) {
      console.log('function calling error:', { e });
      return {
        tool_call_id: func.id,
        output: (e as Error).message
      };
    }
  });
  await openai.beta.threads.runs.submitToolOutputs(threadId, runId, {
    tool_outputs: await Promise.all(funcResults)
  });
}

export async function chat(event: LambdaEvent, slackClient: WebClient): Promise<string[]> {
  const apiKey = await getParameter('openAIApiKey');
  const openai = new OpenAI({ apiKey });
  const key = event.threadTs ?? event.ts;
  // Step1. Assistant
  const assistant = await createOrGetAssistant(openai);

  // Step2. Thread
  const thread = await createOrGetThread(event, key, { slackClient, openai });

  // Step3. Message
  await createMessage(openai, thread, event);

  // Step4. Run
  const run = await openai.beta.threads.runs.create(thread.id, {
    assistant_id: assistant.id
  });

  // Step5. wait...
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const currentRun = await openai.beta.threads.runs.retrieve(
      thread.id,
      run.id
    );
    if (currentRun.status === 'completed') {
      break;
    } else if (currentRun.status === 'requires_action') {
      const toolCalls =
        currentRun.required_action?.submit_tool_outputs.tool_calls;
      const chain = toolCalls?.filter((call) => call.type === 'function') ?? [];
      if (!chain.length) throw new Error('no function...');
      await callFunctions(chain, thread.id, run.id, openai);
    } else if (
      currentRun.status === 'failed' ||
      currentRun.status === 'cancelled' ||
      currentRun.status === 'expired'
    ) {
      throw new Error(currentRun.status);
    }
  }

  // Step6. Response
  const messages = await openai.beta.threads.messages.list(thread.id);

  const result = [];
  for (const message of messages.data) {
    if (message.role === 'user') break;
    for (const c of message.content) {
      switch (c.type) {
      case 'text':
        result.push(c.text.value);
        break;
      case 'image_file':
        console.log('image_file', c.image_file.file_id);
        result.push(
          'イメージファイルが返されましたがまだサポートしていません'
        );
      }
    }
  }
  return result;
}

async function createOrGetAssistant(openai: OpenAI) {
  try {
    const assistantId = await getParameter('openAIAssistantId');
    return await openai.beta.assistants.retrieve(assistantId);
  } catch (e) {
    // creating new Assistant
    const githubFunctions: OpenAI.Beta.Assistant.Function[] =
      functionDefinitions.map((def) => ({
        type: 'function',
        function: def
      }));
    const assistant = await openai.beta.assistants.create({
      name: await getParameter('assistantName'),
      instructions: await getParameter('assistantInstruction'),
      tools: [{ type: 'code_interpreter' }, ...githubFunctions],
      model: await getParameter('openAIModel'),
      file_ids: []
    });
    await ssmClient.send(
      new PutParameterCommand({
        Name: parameterNames.openAIAssistantId,
        Type: 'String',
        Value: assistant.id,
        Overwrite: true
      })
    );
    return assistant;
  }
}

async function createMessage(
  openai: OpenAI,
  thread: OpenAI.Beta.Thread,
  event: LambdaEvent
) {
  try {
    return await openai.beta.threads.messages.create(thread.id, {
      role: 'user',
      content: event.text
    });
  } catch (e) {
    if (e instanceof APIError) {
      if (e.status === 400 && e.type === 'invalid_request_error') {
        const result = e.message.match(/run (?<runId>run_\w+) is active/);
        if (result?.groups?.runId) {
          await openai.beta.threads.runs.cancel(thread.id, result.groups.runId);
        }
      }
    }
    throw e;
  }
}

async function createOrGetThread(event: LambdaEvent, threadTs: string, opts: {
  openai: OpenAI,
  slackClient: WebClient
}): Promise<OpenAI.Beta.Threads.Thread> {
  const { openai, slackClient } = opts;
  const record = await documentClient.send(
    new GetCommand({
      TableName: process.env.OPENAI_THREAD_TABLE,
      Key: {
        threadTs
      }
    })
  );

  if (record.Item) {
    console.log('found dynamodb record', record.Item);
    const threadId = record.Item?.threadId;
    return openai.beta.threads.retrieve(threadId ?? '');
  }

  console.log('not found dynamodb record. creating new thread...');
  const initialMessages = await makeInitialMessages(event, slackClient);
  const thread = await openai.beta.threads.create({
    messages:
      initialMessages as OpenAI.Beta.Threads.ThreadCreateParams.Message[]
  });
  try {
    await documentClient.send(
      new PutCommand({
        TableName: process.env.OPENAI_THREAD_TABLE,
        Item: {
          threadTs: threadTs,
          threadId: thread.id,
          expiration: (Math.ceil(new Date().getTime() / 1000 + 3 * 60 * 60)).toString()
        }
      })
    );
  } catch (e) {
    console.log('failed to put thread to DynamoDB...', { e });
  }
  return thread;
}

async function makeInitialMessages(event: LambdaEvent, slackClient: WebClient) {
  const makeOpenAIMessages = (
    slackMessage: ConversationsRepliesResponse | ConversationsHistoryResponse
  ) => {
    return (
      slackMessage.messages
        // ?.filter(msg => !msg.bot_id) // exclude bot posts
        ?.map((msg) => {
          let content = msg.blocks?.map((block) => block.text?.text).join('\n');
          if (msg.attachments) {
            content += msg.attachments
              .map((attachment) => {
                const { title, text } = attachment;
                return !!title && !!text
                  ? `${title}\n${text}`
                  : title || text || '';
              })
              .join('\n');
          }
          return { role: 'user', content: content || msg.text || '' } as const;
        })
        .filter((msg) => !!msg.content) ?? []
    );
  };

  // mention on thread reply
  if (event.threadTs) {
    console.log('initializing with thread replies...');
    const history = await slackClient.conversations.replies({
      channel: event.channel,
      ts: event.threadTs,
      limit: 10
    });
    return makeOpenAIMessages(history);
  }

  // mention on main thread
  console.log('initializing with main thread messages...');
  const history = await slackClient.conversations.history({
    channel: event.channel,
    limit: 10
  });
  return makeOpenAIMessages(history);
}
