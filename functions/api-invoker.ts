import { Handler } from 'aws-lambda';
import { getParameter } from './config';
import { AlreadyRunning, chat } from './chat';
import { SectionBlock, WebClient } from '@slack/web-api';

export interface LambdaEvent {
  text: string;
  threadBroadcast: boolean;
  channel: string;
  ts: string;
  threadTs?: string;
}

export const handler: Handler = async (event: LambdaEvent) => {
  console.debug({ event });
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
    console.info({ slackResp });
  } catch (error) {
    if (error instanceof AlreadyRunning) {
      console.warn({
        body: 'It is already running. Double execution is not possible, so the process is terminated.',
        run: error.run
      });
      return;
    }
    console.error({ error });
    const slackResp = await slackClient.chat.postMessage({
      channel: event.channel,
      thread_ts: event.threadTs ?? event.ts,
      text: 'すみません。問題が発生して返信できません。。。',
      reply_broadcast: event.threadBroadcast
    });
    console.info({ slackResp });
  }
};
