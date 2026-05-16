import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { SNSClient } from "@aws-sdk/client-sns";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { EKSClient } from "@aws-sdk/client-eks";
import { EC2Client } from "@aws-sdk/client-ec2";
const endpoint = process.env.FLOCI_ENDPOINT;
const region = process.env.AWS_REGION || "us-east-1";
const credentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test",
};
const base = {
  region,
  credentials,
  ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
};

export const s3 = new S3Client({ ...base, forcePathStyle: true });
export const sqs = new SQSClient(base);
export const sns = new SNSClient(base);
export const lambda = new LambdaClient(base);
export const dynamodb = new DynamoDBClient(base);
export const cwLogs = new CloudWatchLogsClient(base);
export const cw = new CloudWatchClient(base);
export const eks = new EKSClient(base);
export const ec2 = new EC2Client(base);
