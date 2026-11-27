import { Hono } from "hono";
import type { Bindings, UserInfoVariables } from "@/index";
import { pinoLogger } from "@/core/logger";
import type { IOpenTrackingRepository } from "./open-tracking.repository";
import { TRANSPARENT_GIF } from "./tracking-gif";
import { isTrackingToken } from "./tracking-token";

/**
 * The same answer whatever happened: a token that is malformed, unknown, throttled, or a database
 * error all get this GIF. The response therefore reveals nothing about the token, and a broken
 * image never shows in the recipient's mail client.
 */
function pixelResponse(): Response {
  return new Response(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(TRANSPARENT_GIF.byteLength),
      // Every open must reach the Worker: nothing may serve the image from a cache.
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Public route `GET /t/o/:token`, loaded by the recipient's mail client through the tracking
 * image. No authentication: the token is the only key, and it only lets a caller record an open.
 */
export function createOpenTrackingController(
  getRepository: () => IOpenTrackingRepository,
): Hono<{ Bindings: Bindings; Variables: UserInfoVariables }> {
  const controller = new Hono<{ Bindings: Bindings; Variables: UserInfoVariables }>();

  controller.get("/:token", async (c) => {
    const token = c.req.param("token");

    // HEAD is answered by this GET handler too: a probe that downloads nothing is not an open.
    if (c.req.method === "GET" && isTrackingToken(token)) {
      try {
        await getRepository().recordOpen(token, new Date());
      } catch (err) {
        // Never the token itself in the logs.
        pinoLogger.error({ err }, "Failed to record an email open");
      }
    }

    return pixelResponse();
  });

  return controller;
}
