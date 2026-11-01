// `wrangler dev` never fires cron triggers on its own: this calls the Worker's scheduled handler at
// the times of wrangler.jsonc ("17 * * * *" key rotation, "17 3 * * *" SMTP health checks and the
// new-release check), in UTC like Cloudflare. Started by entrypoint.sh next to the Worker.
const PORT = process.env.PORT ?? "8787";
const HOURLY = "17 * * * *";
const DAILY = "17 3 * * *";

async function fire(cron) {
  const url = `http://127.0.0.1:${PORT}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent(cron)}`;
  try {
    const res = await fetch(url);
    console.log(`[scheduler] ${cron} -> ${res.status}`);
  } catch (error) {
    console.error(`[scheduler] ${cron} failed: ${error instanceof Error ? error.message : error}`);
  }
}

let last = "";
setInterval(() => {
  const now = new Date();
  const slot = now.toISOString().slice(0, 16);
  if (slot === last || now.getUTCMinutes() !== 17) return;
  last = slot;
  void fire(HOURLY);
  if (now.getUTCHours() === 3) void fire(DAILY);
}, 15_000);
