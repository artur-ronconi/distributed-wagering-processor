#!/bin/bash
# Runs inside LocalStack when it is ready. Creates every queue so `docker compose up` needs no manual step.
set -euo pipefail

REGION="${AWS_DEFAULT_REGION:-us-east-1}"
ACCOUNT="000000000000"
# Same limit the consumer uses to send a message to the DLQ (SQS_MAX_RECEIVE_COUNT in the app).
MAX_RECEIVE_COUNT="${SQS_MAX_RECEIVE_COUNT:-5}"

create_fifo() {
  awslocal sqs create-queue --region "$REGION" --queue-name "$1" --attributes "$2" >/dev/null
  echo "created queue $1"
}

for suffix in "" "-test"; do
  dlq="wager-transactions-dlq${suffix}.fifo"
  input="wager-transactions${suffix}.fifo"
  events="wagering-events${suffix}.fifo"

  create_fifo "$dlq" '{"FifoQueue":"true","MessageRetentionPeriod":"1209600"}'

  redrive="{\\\"deadLetterTargetArn\\\":\\\"arn:aws:sqs:${REGION}:${ACCOUNT}:${dlq}\\\",\\\"maxReceiveCount\\\":\\\"${MAX_RECEIVE_COUNT}\\\"}"
  create_fifo "$input" "{\"FifoQueue\":\"true\",\"VisibilityTimeout\":\"30\",\"RedrivePolicy\":\"${redrive}\"}"

  create_fifo "$events" '{"FifoQueue":"true"}'
done
