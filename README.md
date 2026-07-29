```txt
pnpm install
pnpm run dev
```

```txt
pnpm run deploy
```

[For generating / synchronizing types based on your Worker configuration, run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```txt
pnpm run cf-typegen
```

Pass `CloudflareBindings` as generics when instantiating `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>();
```

# makisend

MakiSend is a Proof of Concept for a serverless transactional email API built on Cloudflare Workers.

See `AGENTS.md` for the full project context, architecture, conventions, and development workflow.
