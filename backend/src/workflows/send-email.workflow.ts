import { resolveEncryptionKeys } from "@/config/config";
import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { createDatabase } from "@/db/connection";
import { SendEmailRepository } from "@/send-email/send-email.repository";
import { loadEmailForSending } from "@/send-email/send-email.loader";
import { resolveTransportFor } from "@/send-email/transport-resolver";
import {
  runSendEmailFlow,
  SEND_MAX_ATTEMPTS,
  SEND_MAX_RETRIES,
  SEND_RETRY_DELAY_SECONDS,
} from "./send-email.flow";
import type { SendEmailFlowOutcome } from "./send-email.flow";
import type { Bindings } from "@/index";
import type { SendEmailQueueMessage } from "@/send-email/send-email.types";

/** Workflow instance payload: only the id, matching the queue message. */
export type SendEmailParams = SendEmailQueueMessage;

/** Terminal result of a run, returned so the instance completes with a typed payload. */
export type SendEmailRunOutcome = SendEmailFlowOutcome;

export { SEND_MAX_ATTEMPTS, SEND_MAX_RETRIES, SEND_RETRY_DELAY_SECONDS };

/**
 * Durable email delivery pipeline. One instance = one email.
 *
 * The workflow rebuilds the message from `email_contents`, sanitizes the HTML,
 * sends through the SMTP configuration captured at enqueue time, and retries
 * transient failures 3 times (30s apart) inside the same instance. Permanent
 * failures stop immediately. Anything still failing after the last attempt is
 * recorded as `failed` and published to the dead-letter queue.
 */
export class SendEmailWorkflow extends WorkflowEntrypoint<Bindings, SendEmailParams> {
  async run(
    event: WorkflowEvent<SendEmailParams>,
    step: WorkflowStep,
  ): Promise<SendEmailRunOutcome> {
    const env = this.env;
    // Fresh repository per run: the instance may outlive the isolate that
    // started it, so nothing may be cached across durable executions.
    const repository = new SendEmailRepository(createDatabase(env.makisend_db));

    return runSendEmailFlow(
      {
        repository,
        loadEmail: (emailId) =>
          loadEmailForSending(repository, resolveEncryptionKeys(env), emailId),
        resolveTransport: (smtpConfigId) =>
          resolveTransportFor(env, smtpConfigId ?? undefined),
        deadLetterQueue: env.SEND_EMAIL_DLQ,
      },
      event.payload,
      step,
    );
  }
}
