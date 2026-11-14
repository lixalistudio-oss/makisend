# What each sending provider does with `cc`, `bcc` and `reply_to`

Checked on **2026-11-14** against each provider's own documentation. This table
exists so the dashboard can warn on a configuration instead of promising
something the provider will refuse or silently drop.

Two rules came out of the check, and they shape the table:

1. **Over SMTP, all three fields travel by protocol.** Cc and Bcc are extra
   envelope recipients (`RCPT TO`), and `Reply-To` is a standard header. A
   provider does not "support" or "not support" them: it either transmits the
   message as given, or it rewrites it.
2. **What actually differs is the number of recipients per message.** That is
   the number to warn about, and it is the one providers document.

The exception is **Cloudflare Email Service**, which MakiSend drives through the
Worker `send_email` binding rather than SMTP: that binding carries a single
reply address, so a `reply_to` list loses everything after the first entry.

## The table

`yes` = documented as accepted and transmitted. `single` = only the first
address survives. `—` = not checked against official documentation (no claim
made).

| Provider | Group | Cc | Bcc | Reply-To | Max recipients per message | Notes | Source |
|---|---|---|---|---|---|---|---|
| Cloudflare Email Service | service (binding) | yes | yes | **single** | 50 (`to` + `cc` + `bcc`) | Sent through the Worker binding, not SMTP. The sender domain must be onboarded to Email Sending. | [recipients](https://developers.cloudflare.com/email-service/examples/email-sending/recipients/), [Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/) |
| ZeptoMail (Zoho CPaaS) | service | yes | yes | yes | 500 (`to` + `cc` + `bcc`), 15 MB total | Sender domain validated per Mail Agent; SMTP user is the fixed `emailapikey`. | [agents](https://www.zoho.com/cpaas/help/agents.html), [send API](https://www.zoho.com/cpaas/help/api/email-sending.html) |
| Amazon SES | service | yes | yes | yes | 50 (`to` + `cc` + `bcc`) | Sandbox until production access is granted; quotas are per recipient, not per message. | [quotas](https://docs.aws.amazon.com/ses/latest/dg/quotas.html) |
| Postmark | service | yes | yes | yes | 50 (`To` + `Cc` + `Bcc` combined) | Documented explicitly: recipient count is totalled across the three fields. | [sending](https://postmarkapp.com/developer/user-guide/send-email-with-api) |
| SendGrid | service | yes | yes | yes | 1,000 personalizations per message | A single personalization cannot repeat an address across `to`/`cc`/`bcc`. | [personalizations](https://www.twilio.com/docs/sendgrid/for-developers/sending-email/personalizations) |
| Brevo | service | yes | yes | yes | 99 per message version, 2,000 per API request | Figures are the transactional API's; the SMTP relay path is not documented separately. | [send API](https://developers.brevo.com/reference/send-transac-email) |
| Gmail / Google Workspace | mailbox | yes | yes | yes | 100 per message sent over SMTP | Counting is explicit: `To`, `Cc` and `Bcc` addresses all count. 2,000 messages/day per user. | [sending limits](https://knowledge.workspace.google.com/admin/gmail/gmail-sending-limits-in-google-workspace) |
| Microsoft 365 (Exchange Online) | mailbox | yes | yes | yes | Configurable up to 1,000 (administrator setting) | The per-message limit is defined as the addresses in `To:`, `Cc:` and `Bcc:`. 10,000 recipients/day per mailbox. | [limits](https://learn.microsoft.com/en-us/office365/servicedescriptions/exchange-online-service-description/exchange-online-limits) |
| Mailgun | service | yes | yes | yes | — | The per-message recipient cap is not stated on the pages checked. | [sending](https://documentation.mailgun.com/docs/mailgun/user-manual/sending-messages/batch-sending), [API](https://documentation.mailgun.com/docs/mailgun/api-reference/api-overview) |
| Mailjet | service | yes | yes | yes | — | A 50-message-per-call limit is reported by users, not stated on the page checked. | [send endpoints](https://dev.mailjet.com/email/reference/send-emails/) |
| Resend | service | yes | yes | yes | — | `cc` and `bcc` are `string[]` request fields of `POST /emails`, and `reply_to` is accepted too. | [API reference](https://resend.com/docs/api-reference/emails/send-email) |
| Zoho Mail | mailbox | — | — | — | — | The mailbox product, not the transactional service. MakiSend's preset points here. | — |
| SMTP2GO | service | — | — | — | — | Not checked. | — |
| SparkPost | service | — | — | — | — | Not checked. | — |
| Mailtrap (sending) | service | — | — | — | — | Not checked. | — |
| Scaleway Transactional Email | service | — | — | — | — | Not checked. | — |
| iCloud Mail | mailbox | — | — | — | — | Not checked. | — |
| Yahoo Mail | mailbox | — | — | — | — | Not checked. | — |
| Fastmail | mailbox | — | — | — | — | Not checked. | — |

## What this table is not

- It is **not** a sending-limit reference: daily quotas, attachment sizes,
  domain authentication and reputation are separate, and each provider
  documents them in its own way.
- A `—` cell means nobody checked that provider against its own documentation.
  It must not be shown to a user as "not supported".
- A mailbox provider's cap is a side effect of its product: Gmail and Microsoft
  365 are mailboxes, not relays, and their limits describe what a person may
  send from one mailbox.

## What it means for MakiSend

- MakiSend caps `cc` and `bcc` at 10 addresses each. With the single `to`, that
  is at most 21 recipients per message — below the lowest documented ceiling in
  the table (50), so no verified provider can refuse a request MakiSend accepts.
- The only place where a value is silently altered is Cloudflare Email Service,
  where a `reply_to` list keeps its first address. A warning belongs there, not
  on the recipient counts.
- For the unchecked providers, the honest message is generic: "MakiSend sends
  this through your provider; if it refuses extra recipients, the send fails and
  the log says so."
