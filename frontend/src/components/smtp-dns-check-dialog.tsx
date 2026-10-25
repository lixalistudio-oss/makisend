import { useEffect, useState } from "react"
import { CheckIcon, CopyIcon, LoaderIcon, SearchCheckIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { fetchApi } from "@/lib/api"
import { useTranslation } from "@/i18n"
import {
  DKIM_SELECTOR_RE,
  DNS_RECORDS,
  STATUS_CLASSES,
  STATUS_LABELS,
  describeCheck,
  isDnsCheckResult,
  recordHost,
  type DnsCheckResult,
} from "@/lib/deliverability"

interface Props {
  /** The saved configuration whose sender domain is checked; null closes the dialog. */
  config: { id: string; senderEmail: string } | null
  onClose: () => void
}

/** SPF, DKIM, DMARC and MX of a configuration's sender domain, read from public DNS. */
export function SmtpDnsCheckDialog({ config, onClose }: Props) {
  return (
    <Dialog open={config !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[85dvh] gap-3 sm:max-w-[640px] sm:gap-4">
        {/* A new key per configuration: the check starts over every time. */}
        {config && <DnsCheck key={config.id} config={config} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

/** A record value with a copy button that confirms in place. */
function RecordValue({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted p-2">
      <code className="block max-h-20 min-w-0 flex-1 overflow-y-auto px-1 py-0.5 font-mono text-xs break-all whitespace-pre-wrap">
        {value}
      </code>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0"
        aria-label={t("deliverability.copyRecordLabel", { record: label })}
        onClick={() =>
          navigator.clipboard.writeText(value).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          })
        }
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? t("deliverability.copiedRecord") : t("deliverability.copyRecord")}
      </Button>
    </div>
  )
}

function DnsCheck({ config, onClose }: { config: NonNullable<Props["config"]>; onClose: () => void }) {
  const { t } = useTranslation()
  const [selector, setSelector] = useState("")
  const [result, setResult] = useState<DnsCheckResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const selectorInvalid = selector.trim() !== "" && !DKIM_SELECTOR_RE.test(selector.trim())

  const run = async (dkimSelector: string) => {
    setLoading(true)
    setFailed(false)
    try {
      const query = dkimSelector ? `?dkimSelector=${encodeURIComponent(dkimSelector)}` : ""
      const res = await fetchApi(`/smtp-config/${config.id}/dns-check${query}`)
      const data: unknown = await res.json().catch(() => null)
      if (!res.ok || !isDnsCheckResult(data)) throw new Error("dns check failed")
      setResult(data)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    run("")
  }, [])

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("deliverability.dnsTitle")}</DialogTitle>
        <DialogDescription>
          {result
            ? t("deliverability.dnsDescription", { domain: result.domain })
            : t("deliverability.dnsDescriptionPending", { email: config.senderEmail })}
        </DialogDescription>
      </DialogHeader>

      {/* The gutter keeps the scrollbar off the cards' right edge. */}
      <div className="flex max-h-[calc(85dvh-14rem)] flex-col gap-4 overflow-y-auto pr-2 [scrollbar-gutter:stable]">
        <Field data-invalid={selectorInvalid}>
          <FieldLabel htmlFor="dkim-selector">{t("deliverability.selectorLabel")}</FieldLabel>
          <Input
            id="dkim-selector"
            value={selector}
            placeholder={t("deliverability.selectorPlaceholder")}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            onChange={(e) => setSelector(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !selectorInvalid && !loading) run(selector.trim()) }}
            aria-invalid={selectorInvalid}
          />
          {selectorInvalid ? (
            <FieldError>{t("deliverability.selectorHelp")}</FieldError>
          ) : (
            <FieldDescription className="text-xs leading-snug sm:text-sm">{t("deliverability.selectorHelp")}</FieldDescription>
          )}
        </Field>

        {loading && !result ? (
          <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <LoaderIcon className="size-4 animate-spin" />
            {t("deliverability.dnsLoading")}
          </p>
        ) : failed ? (
          <p role="alert" className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive">
            {t("deliverability.dnsFailed")}
          </p>
        ) : result ? (
          <ul className="flex flex-col divide-y divide-border rounded-xl border" aria-busy={loading}>
            {DNS_RECORDS.map(({ id, label }) => {
              const item = result[id]
              const host = recordHost(id, result)
              return (
                <li key={id} className="flex min-w-0 flex-col gap-2 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{t(label)}</span>
                    <Badge variant="outline" className={STATUS_CLASSES[item.status]}>
                      {t(STATUS_LABELS[item.status])}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{describeCheck(item, result.domain, t)}</p>
                  {item.record && host && (
                    <p className="text-xs text-muted-foreground">
                      {t("deliverability.host", { host })}
                    </p>
                  )}
                  {item.record && <RecordValue value={item.record} label={t(label)} />}
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>

      <DialogFooter className="flex-row justify-end">
        <Button variant="outline" onClick={onClose}>
          {t("common.close")}
        </Button>
        <Button onClick={() => run(selector.trim())} disabled={loading || selectorInvalid}>
          {loading ? <LoaderIcon className="animate-spin" /> : <SearchCheckIcon />}
          {t("deliverability.checkAgain")}
        </Button>
      </DialogFooter>
    </>
  )
}
