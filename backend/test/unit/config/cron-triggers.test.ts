/**
 * One `scheduled` handler for two crons (wrangler.jsonc `triggers.crons`): the daily SMTP health
 * checks and the hourly key rotation. It dispatches on the cron expression.
 *
 * ── Failure analysis ──
 *  C1  Two `triggers` keys in one environment: JSON keeps the last one, a job silently never runs.
 *  C2  The hourly expression is edited in wrangler.jsonc but not in KEY_ROTATION_CRON: rotation
 *      never runs (every run falls through to the health checks).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KEY_ROTATION_CRON } from "@/key-rotation";

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(here, "../../../wrangler.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, "");

describe("cron triggers (wrangler.jsonc)", () => {
  it("declares `triggers` once (C1)", () => {
    expect(raw.match(/"triggers"\s*:/g)).toHaveLength(1);
  });

  it("schedules the daily health check and the hourly key rotation (C2)", () => {
    const config = JSON.parse(raw) as { triggers: { crons: string[] } };
    expect(config.triggers.crons).toEqual(["17 3 * * *", KEY_ROTATION_CRON]);
  });
});
