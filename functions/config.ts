import { type GetParameterCommandOutput } from '@aws-sdk/client-ssm';

const extensionPort = 2773;

const toName = (name: string): string => `${process.env.PARAMETER_NAME_PREFIX}/${name}`;
export const parameterNames = {
  slackBotToken: toName('botToken'),
  githubAppPrivateKey: toName('githubApp/privateKey'),
  githubAppId: toName('githubApp/appId'),
  openAIApiKey: toName('openai/apiKey'),
  openAIAssistantId: toName('assistantId'),
  openAIModel: toName('model'),
  assistantInstruction: toName('instruction'),
  assistantName: toName('name')
} as const;

export class ParameterError extends Error {
  constructor(message: string, readonly response: Response) {
    super(message);
  }
}

export async function getParameter(name: keyof typeof parameterNames): Promise<string> {
  const params = new URLSearchParams();
  params.set('name', parameterNames[name]);
  params.set('withDecryption', 'true');
  const resp = await fetch(
    `http://localhost:${extensionPort}/systemsmanager/parameters/get?${params.toString()}`,
    {
      headers: {
        'X-Aws-Parameters-Secrets-Token': process.env.AWS_SESSION_TOKEN ?? '' // required for Lambda extension
      }
    }
  );
  if (resp.ok) {
    const output = (await resp.json()) as GetParameterCommandOutput;
    return output.Parameter?.Value ?? '';
  } else {
    throw new ParameterError(`${name}:${resp.status}:${await resp.text()}`, resp);
  }
}
