/**
 * Two Wrangler configurations describe the same Worker:
 * - backend/wrangler.jsonc: our own deployments (GitHub Actions, production + preview);
 * - wrangler.jsonc at the root: the "Deploy to Cloudflare" button and Workers Builds in copies.
 *
 * ── Failure analysis ──
 *  W1  A binding, queue, workflow or cron is added to one file only: installs made with the
 *      button break (missing binding) or silently skip a job.
 *  W2  The root file points at the wrong paths: the button builds no dashboard or applies no
 *      migration.
 *  W3  The root file ships a real database id: the button would bind someone else's database.
 *  W4  The button's install has no BETTER_AUTH_URL / FRONTEND_URL secrets: the Worker must fall
 *      back to its own origin, or sign-in and CORS refuse the dashboard.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { withPublicUrls, type Bindings } from "@/index";

const here = dirname(fileURLToPath(import.meta.url));
const backendDir = join(here, "../../..");
const rootDir = join(backendDir, "..");

/** Strips `//` line comments (no `//` appears inside the strings of these files). */
function readJsonc(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\s*\/\/.*$/gm, "")) as Record<string, unknown>;
}

const backend = readJsonc(join(backendDir, "wrangler.jsonc"));
const root = readJsonc(join(rootDir, "wrangler.jsonc"));

type D1 = { binding: string; database_id: string; migrations_dir: string };

describe("W1 root wrangler.jsonc matches backend/wrangler.jsonc", () => {
  it.each(["compatibility_date", "compatibility_flags", "send_email", "queues", "workflows", "triggers"])(
    "same %s",
    (key) => {
      expect(root[key]).toEqual(backend[key]);
    },
  );

  it("same D1 binding name", () => {
    expect((root.d1_databases as D1[]).map((d) => d.binding)).toEqual(
      (backend.d1_databases as D1[]).map((d) => d.binding),
    );
  });
});

describe("W2 root wrangler.jsonc paths", () => {
  it("points at the backend entry point, the migrations and the dashboard build", () => {
    expect(existsSync(join(rootDir, root.main as string))).toBe(true);
    expect(existsSync(join(rootDir, (root.d1_databases as D1[])[0].migrations_dir))).toBe(true);
    expect((root.assets as { directory: string }).directory).toBe("./frontend/dist");
  });

  it("the root deploy script is what Workers Builds runs, and only there", () => {
    const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.build).toBe("pnpm --filter frontend build");
    expect(pkg.scripts.deploy).toBe("bash scripts/workers-builds-deploy.sh");
    const script = readFileSync(join(rootDir, "scripts/workers-builds-deploy.sh"), "utf8");
    expect(script).toContain('if [ "${WORKERS_CI:-}" != "1" ]');
    expect(script).toContain("wrangler d1 migrations apply makisend_db --remote");
  });
});

describe("W3 root wrangler.jsonc ships no real resource id", () => {
  it("uses a placeholder database id", () => {
    expect((root.d1_databases as D1[])[0].database_id).toBe("00000000-0000-4000-8000-000000000000");
    expect((root.d1_databases as D1[])[0].database_id).not.toBe((backend.d1_databases as D1[])[0].database_id);
  });
});

describe("W4 withPublicUrls", () => {
  const base = { makisend_db: {} as D1Database } satisfies Partial<Bindings>;

  it("falls back to the request origin when the URLs are unset", () => {
    const env = withPublicUrls(base as Bindings, "https://makisend.acme.workers.dev/api/auth/get-session");
    expect(env.BETTER_AUTH_URL).toBe("https://makisend.acme.workers.dev");
    expect(env.FRONTEND_URL).toBe("https://makisend.acme.workers.dev");
  });

  it("FRONTEND_URL defaults to BETTER_AUTH_URL when only that one is set", () => {
    const env = withPublicUrls({ ...base, BETTER_AUTH_URL: "https://mail.acme.com" } as Bindings, "https://x.workers.dev/");
    expect(env.FRONTEND_URL).toBe("https://mail.acme.com");
  });

  it("keeps configured values and returns the same object", () => {
    const configured = { ...base, BETTER_AUTH_URL: "https://a.example", FRONTEND_URL: "https://b.example" } as Bindings;
    expect(withPublicUrls(configured, "https://c.example/")).toBe(configured);
  });
});
