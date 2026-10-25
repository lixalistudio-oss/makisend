import type { BounceWebhookProvider, DeliveryEvent } from "../bounce-webhooks.types";
import { joinReason, parseTaggedEmailId } from "../correlation";
import { constantTimeStringEqual } from "../signatures";
import { asAddress, asObject, asString, readKey } from "./common";

/**
 * Postmark does not sign webhooks. Its webhook settings take HTTP Basic auth credentials
 * instead: the owner picks a password, saves it here as the secret and in Postmark, and every
 * request must carry it (`Authorization: Basic base64(user:password)`; the user name is not
 * checked). https://postmarkapp.com/developer/webhooks/webhooks-overview
 *
 * MakiSend adds `X-PM-Metadata-makisend-email-id` at send time; Postmark strips the header
 * and returns the value in `Metadata`.
 * https://postmarkapp.com/developer/user-guide/send-email-with-smtp
 */
const METADATA_KEY = "makisend-email-id";
const SECRET = /^[\x21-\x7e]{16,256}$/;

/** Bounce types about the address itself. https://postmarkapp.com/developer/api/bounce-api#bounce-types */
const HARD_TYPES = new Set(["HardBounce", "BadEmailAddress"]);
/** Final failures that say nothing about the address. */
const SOFT_TYPES = new Set(["SoftBounce", "DnsError", "Blocked", "DMARCPolicy"]);

function basicAuthPassword(header: string | undefined): string | null {
  const match = header ? /^Basic\s+([A-Za-z0-9+/]+={0,2})$/i.exec(header.trim()) : null;
  if (!match?.[1]) return null;
  let decoded: string;
  try {
    decoded = atob(match[1]);
  } catch {
    return null;
  }
  const colon = decoded.indexOf(":");
  return colon >= 0 ? decoded.slice(colon + 1) : null;
}

export const postmarkProvider: BounceWebhookProvider = {
  id: "postmark",
  label: "Postmark",

  async isValidSecret(secret) {
    return SECRET.test(secret.trim());
  },

  async verify(request, secret) {
    const password = basicAuthPassword(request.header("Authorization"));
    return password !== null && (await constantTimeStringEqual(password, secret.trim()));
  },

  parse(body) {
    const record = asObject(body);
    if (!record) return [];
    const recordType = asString(record.RecordType);
    const base = {
      emailId: parseTaggedEmailId(readKey(asObject(record.Metadata), METADATA_KEY)),
      messageId: null,
    };
    const id = typeof record.ID === "number" ? String(record.ID) : asString(record.ID);

    if (recordType === "Delivery") {
      const messageId = asString(record.MessageID);
      const recipient = asAddress(record.Recipient);
      if (!messageId) return [];
      // Postmark's MessageID, never the address: event keys are stored in clear. MakiSend sends one recipient per message.
      return [{ ...base, eventKey: `delivery:${messageId}`, kind: "delivered", hard: false, recipient, reason: "" }];
    }

    if (recordType === "SpamComplaint") {
      if (!id) return [];
      return [{ ...base, eventKey: `complaint:${id}`, kind: "complained", hard: false, recipient: asAddress(record.Email), reason: "" }];
    }

    if (recordType !== "Bounce" || !id) return [];
    const type = asString(record.Type) ?? "";
    const recipient = asAddress(record.Email);
    const reason = joinReason(type, typeof record.TypeCode === "number" ? `type ${record.TypeCode}` : null);
    const event = (kind: DeliveryEvent["kind"], hard: boolean): DeliveryEvent[] => [
      { ...base, eventKey: `bounce:${id}`, kind, hard, recipient, reason },
    ];

    if (HARD_TYPES.has(type)) return event("bounced", true);
    if (SOFT_TYPES.has(type)) return event("bounced", false);
    if (type === "Transient") return event("deferred", false);
    if (type === "SpamComplaint") return event("complained", false);
    // Auto-responders, unsubscribes, challenge-verifications...: not delivery outcomes.
    return [];
  },

  correlationHeaders(emailId) {
    return { [`X-PM-Metadata-${METADATA_KEY}`]: emailId };
  },
};
