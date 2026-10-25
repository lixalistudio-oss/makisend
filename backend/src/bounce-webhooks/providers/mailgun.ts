import type { BounceWebhookProvider, DeliveryEvent } from "../bounce-webhooks.types";
import { joinReason, parseTaggedEmailId } from "../correlation";
import { bytesToHex, constantTimeStringEqual, hmacSha256 } from "../signatures";
import { EMAIL_ID_TAG, asAddress, asCode, asEnhancedStatus, asObject, asString, isDeadAddress, type JsonObject } from "./common";

/**
 * Mailgun signs each webhook with the account's HTTP webhook signing key: the body's
 * `signature` object holds `timestamp`, `token` and `signature`, the hex HMAC-SHA256 of
 * `timestamp + token`. Events on a subaccount also carry `parent-signature`, made with the
 * primary account's key: either one is accepted.
 * https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/securing-webhooks
 *
 * Freshness is not checked, for the reason given for SendGrid: retried events are applied once.
 *
 * MakiSend adds `X-Mailgun-Variables: {"makisend_email_id":...}` at send time; Mailgun echoes
 * it in `user-variables`. `message.headers.message-id` (no angle brackets) is the fallback,
 * and Mailgun keeps it even when it redacts recipients.
 */
const SECRET = /^[\x21-\x7e]{8,256}$/;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toEvent(data: JsonObject): DeliveryEvent | null {
  const name = asString(data.event);
  const eventKey = asString(data.id);
  if (!name || !eventKey) return null;

  const headers = asObject(asObject(data.message)?.headers);
  const base = {
    eventKey,
    recipient: asAddress(data.recipient),
    emailId: parseTaggedEmailId(asObject(data["user-variables"])?.[EMAIL_ID_TAG]),
    messageId: asString(headers?.["message-id"]),
  };

  switch (name) {
    case "delivered":
      return { ...base, kind: "delivered", hard: false, reason: "" };
    case "complained":
      return { ...base, kind: "complained", hard: false, reason: "" };
    case "failed": {
      const status = asObject(data["delivery-status"]);
      const code = asCode(status?.code);
      const enhanced = asEnhancedStatus(status?.["enhanced-code"]);
      const reason = asString(data.reason);
      if (asString(data.severity) !== "permanent") {
        // Mailgun keeps retrying a temporary failure.
        return { ...base, kind: "deferred", hard: false, reason: joinReason(code, enhanced) };
      }
      const addressLevel = asString(status?.["bounce-type"]) === "hard" || reason === "suppress-bounce";
      return {
        ...base,
        kind: "bounced",
        hard: isDeadAddress(enhanced, addressLevel),
        reason: joinReason(code, enhanced, reason),
      };
    }
    default:
      return null;
  }
}

export const mailgunProvider: BounceWebhookProvider = {
  id: "mailgun",
  label: "Mailgun",

  async isValidSecret(secret) {
    return SECRET.test(secret.trim());
  },

  async verify(request, secret) {
    const signature = asObject(asObject(parseJson(request.rawBody))?.signature);
    const timestamp = asString(signature?.timestamp) ?? asCode(signature?.timestamp);
    const token = asString(signature?.token);
    if (!signature || !timestamp || !token) return false;

    const expected = bytesToHex(await hmacSha256(new TextEncoder().encode(secret.trim()), `${timestamp}${token}`));
    for (const field of ["signature", "parent-signature"]) {
      const value = asString(signature[field]);
      if (value && (await constantTimeStringEqual(value.toLowerCase(), expected))) return true;
    }
    return false;
  },

  parse(body) {
    const data = asObject(asObject(body)?.["event-data"]);
    const event = data ? toEvent(data) : null;
    return event ? [event] : [];
  },

  correlationHeaders(emailId) {
    return { "X-Mailgun-Variables": JSON.stringify({ [EMAIL_ID_TAG]: emailId }) };
  },
};
