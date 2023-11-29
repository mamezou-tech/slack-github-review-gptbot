import { APIGatewayProxyHandler } from 'aws-lambda';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { LambdaEvent } from './api-invoker';

const lambdaClient = new LambdaClient();

interface VerificationRequest {
  type: 'url_verification';
  challenge: string;
}

interface EventCallBack {
  type: 'event_callback';
  event: {
    type: 'app_mention';
    subtype?: string;
    user: string;
    channel: string;
    text: string;
    ts: string;
    thread_ts: string;
  };
}

type SlackRequest = VerificationRequest | EventCallBack;

export const handler: APIGatewayProxyHandler = async (event) => {
  const request: SlackRequest = JSON.parse(event.body || '{}');
  switch (request.type) {
  case 'event_callback': {
    const event: LambdaEvent = {
      channel: request.event.channel,
      text: request.event.text.replaceAll(/<@U[0-9A-Z]+>/g, ''), // メンション自体を除去
      ts: request.event.ts,
      threadTs: request.event.thread_ts,
      threadBroadcast: request.event.subtype === 'thread_broadcast'
    };
    await lambdaClient.send(
      new InvokeCommand({
        InvocationType: 'Event', // 非同期実行
        FunctionName: process.env.API_INVOKER_NAME,
        Payload: JSON.stringify(event)
      })
    );

    return {
      statusCode: 200,
      body: '',
      headers: {
        'Content-Type': 'text/plain'
      }
    };
  }
  case 'url_verification':
    return {
      statusCode: 200,
      body: request.challenge,
      headers: {
        'Content-Type': 'text/plain'
      }
    };
  }
};
