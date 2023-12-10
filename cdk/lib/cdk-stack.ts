import * as cdk from 'aws-cdk-lib';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Effect } from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { FunctionUrlAuthType } from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { AttributeType, BillingMode, TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const callbackRole = new iam.Role(this, 'GptSlackGatewayLambdaRole', {
      roleName: `${this.stackName}-callback-lambda-role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
      inlinePolicies: {
        InvokerLambdaInvoke: new iam.PolicyDocument({
          statements: [new iam.PolicyStatement({
            effect: Effect.ALLOW,
            resources: [`arn:aws:lambda:*:${this.account}:function:${this.stackName}-*`],
            actions: ['lambda:InvokeFunction']
          })]
        })
      }
    });

    const parameterNamePrefix = scope.node.tryGetContext('parameterNamePrefix') ?? '/slack/app/gpt';
    const invokerRole = new iam.Role(this, 'GptApiInvokerLambdaRole', {
      roleName: `${this.stackName}-api-invoker-lambda-role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
      inlinePolicies: {
        SsmParameterRead: new iam.PolicyDocument({
          statements: [new iam.PolicyStatement({
            effect: Effect.ALLOW,
            resources: [
              `arn:aws:ssm:*:${this.account}:parameter${parameterNamePrefix}/*`,
            ],
            actions: ['ssm:GetParameter']
          })]
        }),
        SsmParameterReadWrite: new iam.PolicyDocument({
          statements: [new iam.PolicyStatement({
            effect: Effect.ALLOW,
            resources: [
              `arn:aws:ssm:*:${this.account}:parameter${parameterNamePrefix}/assistantId`
            ],
            actions: ['ssm:PutParameter', 'ssm:GetParameter']
          })]
        }),
        DynamoDBTable: new iam.PolicyDocument({
          statements: [new iam.PolicyStatement({
            effect: Effect.ALLOW,
            resources: [
              `arn:aws:dynamodb:*:${this.account}:table/${this.stackName}-OpenAIThread`
            ],
            actions: ['dynamodb:GetItem', 'dynamodb:PutItem']
          })]
        })
      }
    });
    const logGroup = new logs.LogGroup(this, 'LambdaLogGroup', {
      logGroupName: `/slack/app/gpt/${this.stackName}`,
      retention: RetentionDays.ONE_MONTH,
    });

    // ①コールバックAPI(callback)
    const callback = new NodejsFunction(this, 'SlackEventCallbackFunction', {
      role: callbackRole,
      functionName: `${this.stackName}-callback`,
      description: 'Slack event callback entry point',
      entry: '../functions/callback.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(3),
      logGroup,
      applicationLogLevel: 'INFO',
      systemLogLevel: 'INFO',
      logFormat: 'JSON',
      environment: {
        API_INVOKER_NAME: `${this.stackName}-api-invoker`
      }
    });
    const funcUrl = new lambda.FunctionUrl(this, 'SlackEventCallbackFunctionUrl', {
      function: callback,
      authType: FunctionUrlAuthType.NONE
    });

    // ②アシスタントAPI実行(api-invoker)
    // https://docs.aws.amazon.com/systems-manager/latest/userguide/ps-integration-lambda-extensions.html
    // AWS provided ssm parameter store extension
    const parameterStoreExtension = lambda.LayerVersion.fromLayerVersionArn(this, 'ParameterStoreExtension',
      'arn:aws:lambda:ap-northeast-1:133490724326:layer:AWS-Parameters-and-Secrets-Lambda-Extension:11');
    const invoker = new NodejsFunction(this, 'GptApiInvokerFunction', {
      role: invokerRole,
      functionName: `${this.stackName}-api-invoker`,
      description: 'Invoke OpenAI Assistants API',
      entry: '../functions/api-invoker.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(120),
      layers: [parameterStoreExtension],
      logGroup,
      applicationLogLevel: 'INFO',
      systemLogLevel: 'INFO',
      logFormat: 'JSON',
      environment: {
        OPENAI_THREAD_TABLE: `${this.stackName}-OpenAIThread`,
        PARAMETER_NAME_PREFIX: parameterNamePrefix
      }
    });

    new dynamodb.Table(this, 'ThreadRelationTable', {
      tableName: `${this.stackName}-OpenAIThread`,
      billingMode: BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: 'threadTs',
        type: AttributeType.STRING
      },
      encryption: TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: 'expiration',
      removalPolicy: RemovalPolicy.DESTROY
    });

    new cdk.CfnOutput(this, 'lambda-function-url', {
      value: funcUrl.url
    });
  }
}
