import { Handler } from 'aws-lambda';
import { getParameter } from './config';
import { chat } from './chat';
import { SectionBlock, WebClient } from '@slack/web-api';

export interface LambdaEvent {
  text: string;
  threadBroadcast: boolean;
  channel: string;
  ts: string;
  threadTs?: string;
}

export const handler: Handler = async (event: LambdaEvent) => {
  const slackClient = new WebClient(await getParameter('slackBotToken'));

  try {
    const replies = await chat(event, slackClient);
    const blocks: SectionBlock[] = replies.map((text) => ({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text
      }
    }));
    const slackResp = await slackClient.chat.postMessage({
      channel: event.channel,
      thread_ts: event.threadTs ?? event.ts,
      text: replies.join('\n'),
      reply_broadcast: event.threadBroadcast,
      blocks
    });
    console.log(slackResp);
  } catch (e) {
    console.log('failed...', { e });
    const slackResp = await slackClient.chat.postMessage({
      channel: event.channel,
      thread_ts: event.threadTs ?? event.ts,
      text: 'すみません。問題が発生して返信できません。。。',
      reply_broadcast: event.threadBroadcast
    });
    console.log(slackResp);
  }
};
