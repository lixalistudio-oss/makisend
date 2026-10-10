/**
 * Cloudflare Workflows module — durable orchestration of async delivery.
 *
 * HTTP and the queue stay outside: the controller produces to the queue, the
 * consumer starts a workflow instance, and the workflow owns the SMTP attempt
 * plus the queue-cycle retry ladder.
 */
export { SendEmailWorkflow, resolveSendEmailRunEnd, MAX_QUEUE_CYCLES } from "./send-email.workflow";
export type { SendEmailParams, SendEmailRunOutcome, RunEndDeps } from "./send-email.workflow";
