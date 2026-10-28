import { useState } from "react"
import { toast } from "sonner"
import { CheckCircleIcon, LoaderIcon, PlugZapIcon, XCircleIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SmtpPresetPicker } from "@/components/smtp-preset-picker"
import { DialogFooter } from "@/components/ui/dialog"
import { fetchApi } from "@/lib/api"
import { useTranslation, type UiKey } from "@/i18n"
import {
  DEFAULT_PORT,
  SMTP_PORTS,
  cleanHostname,
  fieldErrorsFrom,
  isCheckResult,
  securityForPort,
  type CheckResult,
  type FieldErrors,
  type SmtpPreset,
  type SmtpSecurity,
} from "@/lib/smtp-form"

export interface SmtpConfigValues {
  smtpHostname: string
  smtpPort: number
  smtpSecurity: SmtpSecurity
  smtpUsername: string
  senderEmail: string
}

interface Props {
  /** Set when editing: the password is then optional ("leave blank to keep it") and the check can use the stored one. */
  editingId: string | null
  initial: SmtpConfigValues
  onSaved: () => void
  onCancel: () => void
}

const SECURITY_LABEL: Record<SmtpSecurity, UiKey> = {
  tls: "smtp.securityTlsLabel",
  starttls: "smtp.securityStarttlsLabel",
}

/**
 * The create / edit form of an SMTP configuration. It asks for what a connection needs
 * (server, port, security, user, password, sender) and can try the connection before saving:
 * a wrong hostname or port is found here, with the reason, and not four retries later in the logs.
 */
export function SmtpConfigForm({ editingId, initial, onSaved, onCancel }: Props) {
  const { t } = useTranslation()
  const [hostname, setHostname] = useState(initial.smtpHostname)
  const [port, setPort] = useState(String(initial.smtpPort))
  const [security, setSecurity] = useState<SmtpSecurity>(initial.smtpSecurity)
  const [username, setUsername] = useState(initial.smtpUsername)
  const [password, setPassword] = useState("")
  const [senderEmail, setSenderEmail] = useState(initial.senderEmail)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState<CheckResult | null>(null)
  const [hint, setHint] = useState<UiKey | null>(null)
  const [preset, setPreset] = useState<SmtpPreset | null>(null)

  const portNumber = Number(port)
  const touched = () => setCheck(null)

  /** Fills the server fields from a provider. Clearing the provider keeps what is typed, only the hint goes. */
  const applyPreset = (next: SmtpPreset | null) => {
    setPreset(next)
    setHint(next?.hintKey ?? null)
    if (!next) return
    setHostname(next.hostname)
    setPort(String(next.port))
    setSecurity(next.security)
    setErrors({})
    touched()
  }

  const changePort = (value: string) => {
    setPort(value)
    const n = Number(value)
    // The security follows the port, as the server does when none is sent: 587 with TLS never connects.
    if ((SMTP_PORTS as readonly number[]).includes(n)) setSecurity(securityForPort(n))
    touched()
  }

  /** On leaving the field: a pasted URL becomes a host, and a `:port` moves to the Port field. */
  const tidyHostname = () => {
    const cleaned = cleanHostname(hostname)
    if (cleaned.hostname !== hostname) setHostname(cleaned.hostname)
    if (cleaned.port) changePort(String(cleaned.port))
  }

  const body = () => ({
    smtpHostname: cleanHostname(hostname).hostname,
    smtpPort: portNumber,
    smtpSecurity: security,
    smtpUsername: username.trim(),
    senderEmail: senderEmail.trim(),
    ...(password ? { smtpPassword: password } : {}),
  })

  const complete = hostname.trim() && username.trim() && senderEmail.trim() && Number.isInteger(portNumber) && (editingId || password)

  const runCheck = async () => {
    setChecking(true)
    setCheck(null)
    setErrors({})
    try {
      // New config, or a typed password: check what is in the form. Edit with no new password: check what is stored.
      const useForm = !editingId || password
      const res = await fetchApi(useForm ? "/smtp-config/check" : `/smtp-config/${editingId}/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        ...(useForm ? { body: JSON.stringify({ ...body(), smtpPassword: password }) } : {}),
      })
      const data: unknown = await res.json().catch(() => null)
      if (res.status === 400) {
        setErrors(fieldErrorsFrom(data))
        return
      }
      if (!res.ok || !isCheckResult(data)) throw new Error("check failed")
      setCheck(data)
    } catch {
      setCheck({ ok: false, reason: "unreachable", message: t("smtp.checkCouldNotRun") })
    } finally {
      setChecking(false)
    }
  }

  const save = async () => {
    setSubmitting(true)
    setErrors({})
    try {
      const res = await fetchApi(editingId ? `/smtp-config/${editingId}` : "/smtp-config", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body()),
      })
      if (res.status === 400) {
        setErrors(fieldErrorsFrom(await res.json().catch(() => null)))
        return
      }
      if (!res.ok) throw new Error("save failed")
      toast.success(editingId ? t("smtp.updated") : t("smtp.created"))
      onSaved()
    } catch {
      toast.error(editingId ? t("smtp.updateFailed") : t("smtp.createFailed"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* The body scrolls, the footer does not: a taller form must never push its own buttons out of reach. */}
      <FieldGroup className={`${check ? "max-h-[calc(85dvh-18rem)]" : "max-h-[calc(85dvh-13rem)]"} overflow-y-auto py-1 pr-1 gap-1.5 sm:gap-2`}>
        <Field>
          <FieldLabel htmlFor="preset">{t("smtp.provider")}</FieldLabel>
          <SmtpPresetPicker id="preset" value={preset} onChange={applyPreset} />
          {hint && <FieldDescription className="text-xs leading-snug sm:text-sm">{t(hint)}</FieldDescription>}
        </Field>

        <Field data-invalid={!!errors.smtpHostname}>
          <FieldLabel htmlFor="hostname">{t("smtp.hostname")}</FieldLabel>
          <Input
            id="hostname"
            placeholder="smtp.example.com"
            autoComplete="off"
            spellCheck={false}
            value={hostname}
            onChange={(e) => { setHostname(e.target.value); touched() }}
            onBlur={tidyHostname}
            aria-invalid={!!errors.smtpHostname}
          />
          {errors.smtpHostname ? (
            <FieldError>{errors.smtpHostname}</FieldError>
          ) : (
            <FieldDescription className="text-xs leading-snug sm:text-sm">
              {t("smtp.hostnameHelp")}
            </FieldDescription>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field data-invalid={!!errors.smtpPort}>
            <FieldLabel htmlFor="port">{t("smtp.port")}</FieldLabel>
            <Select value={SMTP_PORTS.some((p) => String(p) === port) ? port : String(DEFAULT_PORT)} onValueChange={(v) => typeof v === "string" && changePort(v)}>
              <SelectTrigger id="port" aria-invalid={!!errors.smtpPort}>
                <SelectValue>{port}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SMTP_PORTS.map((p) => (
                  <SelectItem key={p} value={String(p)}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.smtpPort && <FieldError>{errors.smtpPort}</FieldError>}
          </Field>
          <Field data-invalid={!!errors.smtpSecurity}>
            <FieldLabel htmlFor="security">{t("smtp.security")}</FieldLabel>
            <Select value={security} onValueChange={(v) => { if (v === "tls" || v === "starttls") { setSecurity(v); touched() } }}>
              <SelectTrigger id="security" aria-invalid={!!errors.smtpSecurity}>
                <SelectValue>{security === "tls" ? "TLS" : "STARTTLS"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tls">{t(SECURITY_LABEL.tls)}</SelectItem>
                <SelectItem value="starttls">{t(SECURITY_LABEL.starttls)}</SelectItem>
              </SelectContent>
            </Select>
            {errors.smtpSecurity && <FieldError>{errors.smtpSecurity}</FieldError>}
          </Field>
        </div>
        <FieldDescription className="text-xs leading-snug sm:text-sm">
          {t("smtp.portHelp")}
        </FieldDescription>

        <Field data-invalid={!!errors.smtpUsername}>
          <FieldLabel htmlFor="username">{t("smtp.username")}</FieldLabel>
          <Input
            id="username"
            placeholder="user@example.com"
            autoComplete="off"
            value={username}
            onChange={(e) => { setUsername(e.target.value); touched() }}
            aria-invalid={!!errors.smtpUsername}
          />
          {errors.smtpUsername ? (
            <FieldError>{errors.smtpUsername}</FieldError>
          ) : (
            <FieldDescription className="text-xs leading-snug sm:text-sm">{t("smtp.usernameHelp")}</FieldDescription>
          )}
        </Field>

        <Field data-invalid={!!errors.smtpPassword}>
          <FieldLabel htmlFor="password">{t("smtp.password")}</FieldLabel>
          <Input
            id="password"
            type="password"
            placeholder="••••••••"
            autoComplete="new-password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); touched() }}
            aria-invalid={!!errors.smtpPassword}
          />
          {errors.smtpPassword ? (
            <FieldError>{errors.smtpPassword}</FieldError>
          ) : (
            <FieldDescription className="text-xs leading-snug sm:text-sm">
              {editingId ? t("smtp.passwordKeepHelp") : t("smtp.passwordHelp")}
            </FieldDescription>
          )}
        </Field>

        <Field data-invalid={!!errors.senderEmail}>
          <FieldLabel htmlFor="senderEmail">{t("smtp.senderEmail")}</FieldLabel>
          <Input
            id="senderEmail"
            type="email"
            placeholder="noreply@example.com"
            value={senderEmail}
            onChange={(e) => setSenderEmail(e.target.value)}
            aria-invalid={!!errors.senderEmail}
          />
          {errors.senderEmail ? (
            <FieldError>{errors.senderEmail}</FieldError>
          ) : (
            <FieldDescription className="text-xs leading-snug sm:text-sm">
              {t("smtp.senderEmailHelp")}
            </FieldDescription>
          )}
        </Field>

      </FieldGroup>
      {/* Outside the scrolling body: the answer to "Test connection" must be seen without scrolling for it. */}
      {check && (
        <div
          role="status"
          className={`flex items-start gap-2 rounded-xl border p-4 text-sm ${check.ok ? "border-success/40 text-success" : "border-destructive/40 text-destructive"}`}
        >
          {check.ok ? <CheckCircleIcon className="mt-0.5 size-4 shrink-0" /> : <XCircleIcon className="mt-0.5 size-4 shrink-0" />}
          <span>{check.ok ? t("smtp.checkOk") : check.message}</span>
        </div>
      )}
      <DialogFooter className="flex-row justify-end">
        <Button variant="outline" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button variant="outline" onClick={runCheck} disabled={!complete || checking || submitting}>
          {checking ? <LoaderIcon className="animate-spin" /> : <PlugZapIcon />}
          {checking ? t("smtp.checking") : t("smtp.testConnection")}
        </Button>
        <Button onClick={save} disabled={!complete || submitting || checking}>
          {submitting ? t("smtp.saving") : editingId ? t("smtp.saveChanges") : t("smtp.create")}
        </Button>
      </DialogFooter>
    </>
  )
}
