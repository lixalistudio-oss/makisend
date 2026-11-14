import { describe, expect, it } from "vitest"
import { capabilitiesFor } from "@/lib/smtp-capabilities"

describe("capabilitiesFor", () => {
  it("reports what the selected preset does, from its id", () => {
    // Cloudflare's binding carries one reply address; docs/SMTP_CAPABILITIES.md records why.
    expect(capabilitiesFor("cloudflare", "smtp.mx.cloudflare.net")).toEqual({
      cc: "yes",
      bcc: "yes",
      replyTo: "single",
      maxRecipients: 50,
    })
    expect(capabilitiesFor("ses", "email-smtp.eu-west-3.amazonaws.com")?.maxRecipients).toBe(50)
  })

  it("recognises the provider by its host when editing a saved configuration", () => {
    // No preset is selected in the edit dialog, but the host still names the provider.
    expect(capabilitiesFor(null, "SMTP.Office365.com")?.maxRecipients).toBe(1_000)
    expect(capabilitiesFor(null, "smtp.zoho.com")).toBeNull()
  })

  it("says nothing about a provider nobody checked", () => {
    // A warning nobody verified is worse than none: unknown providers get no note.
    expect(capabilitiesFor(null, "live.smtp.mailtrap.io")).toBeNull()
    expect(capabilitiesFor(null, "")).toBeNull()
  })
})
