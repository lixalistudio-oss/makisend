/**
 * Minimal stand-in for the `cloudflare:workers` built-in so Vitest (node
 * environment) can import modules that extend WorkflowEntrypoint. Real
 * workflow behaviour is exercised by invoking `run()` with a stubbed
 * WorkflowStep, not by the Workers runtime.
 */
export class WorkflowEntrypoint {
  constructor(
    protected readonly ctx: unknown,
    protected readonly env: unknown,
  ) {}
}
