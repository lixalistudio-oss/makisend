import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import type { Bindings } from "@/index";

// Placeholder until Step 6 of the Inngest -> Workflows migration ports the
// send-email pipeline. The binding must resolve to a real exported class or
// wrangler refuses to boot/deploy.
export class SendEmailWorkflow extends WorkflowEntrypoint<
  Bindings,
  Record<string, unknown>
> {
  async run(
    _event: WorkflowEvent<Record<string, unknown>>,
    _step: WorkflowStep,
  ): Promise<Record<string, unknown>> {
    return { outcome: "stub" };
  }
}
