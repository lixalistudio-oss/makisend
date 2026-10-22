/**
 * Cloudflare Workflows module — durable orchestration of async delivery.
 *
 * HTTP and the queue stay outside: the controller produces to the queue, the
 * consumer starts a workflow instance, and the workflow owns the SMTP attempts
 * and retry/DLQ decisions.
 */
export { SendEmailWorkflow } from "./send-email.workflow";
export {
  runSendEmailFlow,
  SEND_MAX_ATTEMPTS,
  SEND_MAX_RETRIES,
  SEND_RETRY_DELAY_SECONDS,
} from "./send-email.flow";
export type { SendEmailParams, SendEmailRunOutcome } from "./send-email.workflow";
export type { SendEmailFlowDeps, SendEmailFlowOutcome } from "./send-email.flow";
