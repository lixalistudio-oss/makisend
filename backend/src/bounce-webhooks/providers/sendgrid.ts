import type { BounceWebhookProvider, DeliveryEvent } from "../bounce-webhooks.types";
import { joinReason, parseTaggedEmailId } from "../correlation";
import { importEcdsaP256PublicKey, tryBase64ToBytes, verifyEcdsaP256Sha256 } from "../signatures";
import { EMAIL_ID_TAG, asAddress, asEnhancedStatus, asObject, asString, isDeadAddress } from "./common";

/**
 * SendGrid's Signed Event Webhook: an ECDSA P-256 / SHA-256 signature of
 * `${timestamp}${body}`, DER then base64 in `X-Twilio-Email-Event-Webhook-Signature`, checked
 * with the verification key SendGrid displays (base64 SubjectPublicKeyInfo).
 * https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/getting-started-event-webhook-security-features
 *
 * The timestamp is not checked for freshness: SendGrid retries a failed POST for up to 24
 * hours and does not document whether it re-signs, while every event is applied once anyway
 * (delivery_events is unique on the event id), so a replay changes nothing.
 *
 * MakiSend adds `X-SMTPAPI: {"unique_args":{"makisend_email_id":...}}` at send time;
 * SendGrid echoes unique_args as top-level fields of each event.
 */
const SIGNATURE_HEADER = "X-Twilio-Email-Event-Webhook-Signature";
const TIMESTAMP_HEADER = "X-Twilio-Email-Event-Webhook-Timestamp";

/** Bounce classifications about the address, not the sender or the content. */
const ADDRESS_CLASSIFICATIONS = new Set(["Invalid Address", "Mailbox Unavailable"]);

function toEvent(raw: unknown): DeliveryEvent | null {
  const event = asObject(raw);
  const name = asString(event?.event);
  const eventKey = asString(event?.sg_event_id);
  if (!event || !name || !eventKey) return null;

  const base = {
    eventKey,
    recipient: asAddress(event.email),
    emailId: parseTaggedEmailId(event[EMAIL_ID_TAG]),
    messageId: asString(event["smtp-id"]),
  };
  const status = asEnhancedStatus(event.status);
  const classification = asString(event.bounce_classification);
  const dropReason = asString(event.reason);

  switch (name) {
    case "delivered":
      return { ...base, kind: "delivered", hard: false, reason: "" };
    case "deferred":
      return { ...base, kind: "deferred", hard: false, reason: joinReason(status) };
    case "spamreport":
      return { ...base, kind: "complained", hard: false, reason: "" };
    case "bounce": {
      // "bounce" is SendGrid's permanent refusal, "blocked" its temporary one.
      const permanent = asString(event.type) !== "blocked";
      const addressLevel = classification ? ADDRESS_CLASSIFICATIONS.has(classification) : permanent;
      return {
        ...base,
        kind: "bounced",
        hard: permanent && isDeadAddress(status, addressLevel),
        reason: joinReason(permanent ? "Bounce" : "Blocked", status, classification),
      };
    }
    case "dropped":
      // SendGrid refused to send: only its own suppression lists say something about the address.
      if (dropReason === "Bounced Address" || dropReason === "Invalid Address") {
        return { ...base, kind: "bounced", hard: true, reason: joinReason("Dropped", dropReason) };
      }
      if (dropReason === "Spam Reporting Address") {
        return { ...base, kind: "complained", hard: false, reason: joinReason("Dropped", dropReason) };
      }
      return null;
    default:
      return null;
  }
}

export const sendgridProvider: BounceWebhookProvider = {
  id: "sendgrid",
  label: "SendGrid",

  async isValidSecret(secret) {
    return (await importEcdsaP256PublicKey(secret)) !== null;
  },

  async verify(request, secret) {
    const signature = request.header(SIGNATURE_HEADER);
    const timestamp = request.header(TIMESTAMP_HEADER);
    if (!signature || !timestamp) return false;
    const [key, der] = [await importEcdsaP256PublicKey(secret), tryBase64ToBytes(signature.trim())];
    if (!key || !der) return false;
    return verifyEcdsaP256Sha256(key, der, `${timestamp}${request.rawBody}`);
  },

  parse(body) {
    if (!Array.isArray(body)) return [];
    return body.map(toEvent).filter((event): event is DeliveryEvent => event !== null);
  },

  correlationHeaders(emailId) {
    return { "X-SMTPAPI": JSON.stringify({ unique_args: { [EMAIL_ID_TAG]: emailId } }) };
  },
};
