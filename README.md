# slack-github-review-gptbot

Slack GitHub Review Bot using OpenAI GPT (Assistants API)

This bot not only engages in chat but also performs pull request operations on behalf of the reviewer, utilizing OpenAI's function-calling capabilities.

The bot is deployed on AWS Lambda using the AWS CDK.

![architecture](https://i.gyazo.com/9761d45aa58cb7f3c05465c1e6880ddd.png)

## Structure

- **functions**: Lambda event handlers. `callback.ts` and `api-invoker.ts` is Lambda entry point. `github.ts` is the GitHub API to be used. You can change the GitHub API calls by customizing here.
- **cdk**: AWS CDK app project.

## Configuration(SSM Parameter Store)

The bot uses the following parameters.
Register the bot in the AWS SSM Parameter Store for the account/region where the bot will be deployed.

| Path                                | Content                                                     |
|-------------------------------------|-------------------------------------------------------------|
| /slack/app/gpt/botToken             | Bot token generated when creating the Slack App             |
| /slack/app/gpt/githubApp/privateKey | Private key (PEM) generated when creating GitHub App        |
| /slack/app/gpt/githubApp/appId      | App ID generated when creating GitHub App                   |
| /slack/app/gpt/openai/apiKey        | API key for OpenAI API (issued from OpenAI's UI)            |
| /slack/app/gpt/model                | Model name used in Assistant API (e.g. gpt-4)               |
| /slack/app/gpt/instruction          | Custom instructions for Assistant API (GPT system settings) |
| /slack/app/gpt/name                 | Assistant name in Assistant API                             |

The path `/slack/app/gpt` is customizable.

## Deploy to AWS

Set up your AWS configuration in advance.

```shell
cd cdk
cdk deploy --context stackName=<your-cfn-stackname>
# If you want to change the parameter prefix, do the following
cdk deploy --context stackName=<your-cfn-stackname> --context parameterNamePrefix=/your/paramter/prefix
```

## Blog

<https://developer.mamezou-tech.com/blogs/2023/12/06/slack-github-assistantsapi/>