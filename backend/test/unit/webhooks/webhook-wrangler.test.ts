/**
 * The webhooks queue in backend/wrangler.jsonc (the root file is compared to it by
 * root-wrangler.test.ts).
 *
 * ── Failure analysis ──
 *  Q1  max_retries drifts from WEBHOOK_MAX_ATTEMPTS: the queue gives up before our schedule (a
 *      delivery stays pending in the DLQ) or after it (wasted retries).
 *  Q2  The producer binding is missing in one environment: publication throws, nothing is sent.
 *  Q3  Preview consumes the production queue: preview code would POST to real receivers.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WEBHOOK_MAX_ATTEMPTS } from "@/webhooks/webhooks.constants";

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(
  readFileSync(join(here, "../../../wrangler.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, ""),
) as {
  queues: Queues;
  env: { preview: { queues: Queues } };
};

interface Queues {
  producers: { binding: string; queue: string }[];
  consumers: { queue: string; max_retries: number; dead_letter_queue?: string }[];
}

describe.each([
  ["production", config.queues, "makisend-webhooks"],
  ["preview", config.env.preview.queues, "makisend-webhooks-preview"],
])("webhooks queue (%s)", (_env, queues, name) => {
  it("has a WEBHOOK_QUEUE producer on its own queue (Q2, Q3)", () => {
    expect(queues.producers).toContainEqual({ binding: "WEBHOOK_QUEUE", queue: name });
  });

  it("is consumed with max_retries = WEBHOOK_MAX_ATTEMPTS - 1 and a dead-letter queue (Q1)", () => {
    const consumer = queues.consumers.find((c) => c.queue === name);
    expect(consumer).toBeDefined();
    expect(consumer!.max_retries).toBe(WEBHOOK_MAX_ATTEMPTS - 1);
    expect(consumer!.dead_letter_queue).toBe(name.replace("makisend-webhooks", "makisend-webhooks-dlq"));
  });
});
