import type { BounceWebhookProvider, DeliveryEvent, DeliveryEventKind, WebhookRequest } from "../bounce-webhooks.types";
import { joinReason } from "../correlation";
import { base64ToBytes, bytesToBase64, constantTimeStringEqual, hmacSha256, tryBase64ToBytes } from "../signatures";
import { asAddress, asObject, asString } from "./common";

/**
 * Resend signs its webhooks with Svix: HMAC-SHA256 of `${svix-id}.${svix-timestamp}.${body}`,
 * keyed with the base64 part of the `whsec_...` signing secret, sent as `v1,<base64>` in
 * `svix-signature` (space-separated when several). Svix signs every attempt anew, so a
 * timestamp more than 5 minutes off is refused (replay protection).
 * https://docs.svix.com/receiving/verifying-payloads/how-manual
 *
 * Events carry `message_id` (the RFC Message-ID), which is how they are matched to an email.
 */
const TOLERANCE_SECONDS = 5 * 60;
const SECRET = /^whsec_([A-Za-z0-9+/]+={0,2})$/;

/** Permanent bounce sub-types about the message, not the address (SES's, which Resend reuses). */
const MESSAGE_LEVEL_SUBTYPES = new Set(["MessageTooLarge", "ContentRejected", "AttachmentRejected"]);

function svixHeader(request: WebhookRequest, name: string): string | undefined {
  return request.header(`svix-${name}`) ?? request.header(`webhook-${name}`);
}

function kindOf(type: string | null): DeliveryEventKind | null {
  switch (type) {
    case "email.delivered":
      return "delivered";
    case "email.delivery_delayed":
      return "deferred";
    case "email.bounced":
    case "email.suppressed":
      return "bounced";
    case "email.complained":
      return "complained";
    default:
      return null;
  }
}

export const resendProvider: BounceWebhookProvider = {
  id: "resend",
  label: "Resend",

  async isValidSecret(secret) {
    const match = SECRET.exec(secret.trim());
    const key = match?.[1] ? tryBase64ToBytes(match[1]) : null;
    return key !== null && key.length >= 16;
  },

  async verify(request, secret, now) {
    const id = svixHeader(request, "id");
    const timestamp = svixHeader(request, "timestamp");
    const signatures = svixHeader(request, "signature");
    const match = SECRET.exec(secret.trim());
    if (!id || !timestamp || !signatures || !match?.[1] || !/^\d{1,12}$/.test(timestamp)) return false;
    if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false;

    const expected = bytesToBase64(await hmacSha256(base64ToBytes(match[1]), `${id}.${timestamp}.${request.rawBody}`));
    for (const entry of signatures.split(" ")) {
      const [version, signature] = entry.split(",", 2);
      if (version === "v1" && signature && (await constantTimeStringEqual(signature, expected))) return true;
    }
    return false;
  },

  parse(body, request) {
    const event = asObject(body);
    const data = asObject(event?.data);
    const kind = kindOf(asString(event?.type));
    const id = svixHeader(request, "id");
    if (!event || !data || !kind || !id) return [];

    const bounce = asObject(data.bounce);
    const bounceType = asString(bounce?.type);
    const subType = asString(bounce?.subType);
    const hard =
      event.type === "email.suppressed" ||
      (kind === "bounced" && bounceType === "Permanent" && !MESSAGE_LEVEL_SUBTYPES.has(subType ?? ""));
    const reason =
      event.type === "email.suppressed"
        ? "On Resend's suppression list"
        : kind === "bounced"
          ? joinReason(bounceType, subType)
          : "";

    const recipients = (Array.isArray(data.to) ? data.to : [data.to]).map(asAddress);
    const targets = recipients.length > 0 ? recipients : [null];
    return targets.map<DeliveryEvent>((recipient, index) => ({
      eventKey: targets.length > 1 ? `${id}:${index}` : id,
      kind,
      hard: kind === "bounced" && hard,
      recipient,
      emailId: null,
      messageId: asString(data.message_id),
      reason,
    }));
  },

  correlationHeaders() {
    return {};
  },
};
