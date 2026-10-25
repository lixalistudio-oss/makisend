import type { BounceWebhookProvider, BounceWebhookProviderId } from "../bounce-webhooks.types";
import { mailgunProvider } from "./mailgun";
import { postmarkProvider } from "./postmark";
import { resendProvider } from "./resend";
import { sendgridProvider } from "./sendgrid";

export const PROVIDERS: Readonly<Record<BounceWebhookProviderId, BounceWebhookProvider>> = {
  resend: resendProvider,
  sendgrid: sendgridProvider,
  mailgun: mailgunProvider,
  postmark: postmarkProvider,
};

export function providerFor(id: BounceWebhookProviderId): BounceWebhookProvider {
  return PROVIDERS[id];
}
