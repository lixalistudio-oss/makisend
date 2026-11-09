import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import en from "@/i18n/en"
import fr from "@/i18n/fr"
import {
  PRESETS,
  PRESET_GROUPS,
  SMTP_PORTS,
  groupPresets,
  presetMatches,
  securityForPort,
} from "@/lib/smtp-form"

const search = (query: string) => PRESETS.filter((p) => presetMatches(p, query)).map((p) => p.id)

describe("SMTP provider presets", () => {
  it("use only ports a Worker can reach, with the security that port requires", () => {
    for (const preset of PRESETS) {
      expect(SMTP_PORTS, preset.id).toContain(preset.port)
      expect(preset.security, preset.id).toBe(securityForPort(preset.port))
    }
  })

  it("never ship port 25", () => {
    expect(PRESETS.map((p) => p.port)).not.toContain(25)
  })

  it("keep the same port list as the backend", () => {
    const backend = readFileSync(new URL("../../backend/src/smtp-config/smtp-host.ts", import.meta.url), "utf8")
    const ports = /SMTP_PORTS = \[([^\]]+)\]/.exec(backend)?.[1]?.split(",").map((p) => Number(p.trim()))
    expect(ports).toEqual([...SMTP_PORTS])
  })

  it("have unique ids and hostnames without a scheme, port or upper case", () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length)
    for (const preset of PRESETS) {
      expect(preset.hostname, preset.id).toMatch(/^[a-z0-9.-]+$/)
    }
  })

  it("have a hint translated in every language", () => {
    for (const preset of PRESETS) {
      if (!preset.hintKey) continue
      expect(en[preset.hintKey], preset.id).toBeTruthy()
      expect(fr[preset.hintKey], preset.id).toBeTruthy()
      expect(fr[preset.hintKey], preset.id).not.toBe(en[preset.hintKey])
    }
  })

  it("are grouped in a fixed order, each preset once", () => {
    const groups = groupPresets(PRESETS)
    expect(groups.map((g) => g.group)).toEqual([...PRESET_GROUPS])
    expect(groups.flatMap((g) => g.items)).toHaveLength(PRESETS.length)
  })
})

describe("provider search", () => {
  it("returns every preset for an empty query", () => {
    expect(search("")).toHaveLength(PRESETS.length)
    expect(search("   ")).toHaveLength(PRESETS.length)
  })

  it("finds a provider by name, whatever the case, accents or punctuation", () => {
    expect(search("gmail")).toEqual(["gmail"])
    expect(search("PROTON-mail")).toEqual(["proton"])
    expect(search("Prôton")).toEqual(["proton"])
  })

  it("finds a provider by another name people type", () => {
    expect(search("aws")).toEqual(["ses"])
    expect(search("sendinblue")).toEqual(["brevo"])
    expect(search("outlook")).toEqual(["microsoft"])
    expect(search("o365")).toEqual(["microsoft"])
    expect(search("google")).toEqual(["gmail"])
    expect(search("apple")).toEqual(["icloud"])
  })

  it("finds a provider by its host", () => {
    expect(search("smtp.mail.me.com")).toEqual(["icloud"])
    expect(search("ovh.net")).toEqual(["ovh"])
    expect(search("grid")).toEqual(["sendgrid"])
  })

  it("needs every word to match, so a second word narrows the list", () => {
    expect(search("mailgun")).toEqual(["mailgun", "mailgun-eu"])
    expect(search("mailgun eu")).toEqual(["mailgun-eu"])
    expect(search("mailtrap sandbox")).toEqual(["mailtrap-sandbox"])
  })

  it("returns nothing for an unknown provider", () => {
    expect(search("no-such-provider")).toEqual([])
  })
})
