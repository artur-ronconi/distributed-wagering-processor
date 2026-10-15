import { GetQueueUrlCommand, SQSClient } from "@aws-sdk/client-sqs";

import { type AppConfig } from "../../../config/app-config";

const SQS_CLIENT = Symbol("SQS_CLIENT");

const createSqsClient = (config: Pick<AppConfig, "aws">): SQSClient =>
  new SQSClient({
    region: config.aws.region,
    endpoint: config.aws.endpoint,
    credentials:
      config.aws.accessKeyId && config.aws.secretAccessKey
        ? { accessKeyId: config.aws.accessKeyId, secretAccessKey: config.aws.secretAccessKey }
        : undefined,
    // LocalStack returns queue URLs with a host that is not resolvable inside Docker:
    // always send requests to the configured endpoint.
    useQueueUrlAsEndpoint: false,
  });

/** Resolves and caches queue URLs by name. */
class QueueUrlResolver {
  private readonly cache = new Map<string, Promise<string>>();

  constructor(private readonly sqs: SQSClient) {}

  resolve(queueName: string): Promise<string> {
    let url = this.cache.get(queueName);
    if (!url) {
      url = this.sqs.send(new GetQueueUrlCommand({ QueueName: queueName })).then((out) => {
        if (!out.QueueUrl) throw new Error(`Queue ${queueName} not found`);
        return out.QueueUrl;
      });
      url.catch(() => this.cache.delete(queueName));
      this.cache.set(queueName, url);
    }
    return url;
  }
}

export { SQS_CLIENT, createSqsClient, QueueUrlResolver };
