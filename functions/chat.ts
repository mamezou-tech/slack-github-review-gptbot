import { OpenAI } from 'openai';
import { ConversationsHistoryResponse, ConversationsRepliesResponse, WebClient } from '@slack/web-api';
import { functionDefinitions, functions } from './github';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { LambdaEvent } from './api-invoker';
import { getParameter, parameterNames } from './config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const ssmClient = new SSMClient();
const dynamodbClient = new DynamoDBClient();
const documentClient = DynamoDBDocumentClient.from(dynamodbClient);

export class AlreadyRunning extends Error {
  constructor(readonly run: OpenAI.Beta.Threads.Run) {
    super(`already running with ${run.id}`);
  }
}

async function callFunctions(chain: OpenAI.Beta.Threads.Runs.RequiredActionFunctionToolCall[], threadId: string, runId: string, openai: OpenAI) {
  const funcResults = chain.map(async (func) => {
    console.info('function calling:', func.function.name);
    console.debug({ function: func.function });
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      const resp = await functions[func.function.name].call(this, JSON.parse(func.function.arguments));
      console.info('received response');
      console.debug({ functionResp: resp });
      const output = JSON.stringify(resp);
      return {
        tool_call_id: func.id,
        output
      };
    } catch (error) {
      console.warn({ error });
      return {
        tool_call_id: func.id,
        output: (error as Error).message
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
    console.debug({ status: currentRun.status });
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
  console.debug({ messages });

  const result = [];
  for (const message of messages.data) {
    if (message.role === 'user') break;
    for (const c of message.content) {
      switch (c.type) {
      case 'text':
        console.debug({ value: c.text.value, annotations: c.text.annotations });
        result.push(c.text.value);
        break;
      case 'image_file':
        console.info({ imageFile: c.image_file });
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
  const runs = await openai.beta.threads.runs.list(thread.id);
  const running = runs.data.find(run => run.status === 'in_progress');
  if (running) throw new AlreadyRunning(running);

  return await openai.beta.threads.messages.create(thread.id, {
    role: 'user',
    content: event.text
  });
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
    console.info('found dynamodb record');
    console.debug({ item: record.Item });
    const threadId = record.Item?.threadId;
    return openai.beta.threads.retrieve(threadId ?? '');
  }

  console.info('not found dynamodb record. creating new thread...');
  const initialMessages = await makeInitialMessages(event, slackClient);
  console.debug({ initialMessages });
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
          expiration: (Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60).toString() // 3日で失効
        }
      })
    );
  } catch (e) {
    console.error({ dynamodbError: e });
  }
  return thread;
}

async function makeInitialMessages(event: LambdaEvent, slackClient: WebClient) {
  const makeOpenAIMessages = (
    slackMessage: ConversationsRepliesResponse | ConversationsHistoryResponse
  ) => {
    if (!slackMessage.messages?.length) return [];
    return (
      slackMessage.messages.slice(0, slackMessage.messages.length - 1) // exclude current message
        // ?.filter(msg => !msg.bot_id) // exclude bot posts
        ?.map((msg) => {
          let content = msg.blocks?.flatMap((block) => {
            if (block.elements?.length) {
              return block.elements.flatMap(accessory => JSON.stringify(accessory)).join('\n');
            } else {
              return block.text?.text || '';
            }
          }).join('\n');
          if (msg.attachments) {
            content += '\n';
            content += msg.attachments
              .map((attachment) => {
                console.debug({ attachment });
                const { title, text } = attachment;
                return !!title && !!text ? `${title}\n${text}` : title || text || '';
              })
              .join('\n');
          }
          content = (content || msg.text || '').replaceAll(/<@U[0-9A-Z]+>/g, '');
          return { role: 'user', content };
        })
        .filter((msg) => !!msg.content)
    );
  };

  // mention on thread reply
  if (event.threadTs) {
    console.info('initializing with thread replies...');
    const history = await slackClient.conversations.replies({
      channel: event.channel,
      ts: event.threadTs,
      limit: 10
    });
    return makeOpenAIMessages(history);
  }

  // mention on main thread
  console.info('initializing with main thread messages...');
  const history = await slackClient.conversations.history({
    channel: event.channel,
    limit: 3
  });
  return makeOpenAIMessages(history);
}
