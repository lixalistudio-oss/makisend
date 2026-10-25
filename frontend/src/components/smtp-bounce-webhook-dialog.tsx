import { useState } from "react"
import { toast } from "sonner"
import { CheckIcon, CopyIcon, LoaderIcon, UnplugIcon, WebhookIcon } from "lucide-react"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { fetchApi } from "@/lib/api"
import { useTranslation } from "@/i18n"
import {
  WEBHOOK_PROVIDERS,
  supportsBounceWebhook,
  webhookProvider,
  webhookUrl,
  type WebhookProviderId,
} from "@/lib/deliverability"

export interface BounceWebhookConfig {
  id: string
  smtpHostname: string
  bounceWebhookProvider: WebhookProviderId | null
}

interface Props {
  /** The saved configuration whose webhook is managed; null closes the dialog. */
  config: BounceWebhookConfig | null
  onClose: () => void
  /** Called with the provider now connected (null once disconnected). */
  onChanged: (id: string, provider: WebhookProviderId | null) => void
}

/** Connects a provider's delivery webhook (bounces, complaints) to one SMTP configuration. */
export function SmtpBounceWebhookDialog({ config, onClose, onChanged }: Props) {
  return (
    <Dialog open={config !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[85dvh] gap-3 sm:max-w-[560px] sm:gap-4">
        {/* A new key per configuration: the form starts over every time. */}
        {config && <BounceWebhookForm key={config.id} config={config} onClose={onClose} onChanged={onChanged} />}
      </DialogContent>
    </Dialog>
  )
}

function CopyUrl({ value }: { value: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted p-2">
      <code className="block min-w-0 flex-1 px-1 py-0.5 font-mono text-xs break-all">{value}</code>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0"
        aria-label={t("deliverability.webhookCopyUrl")}
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

function BounceWebhookForm({ config, onClose, onChanged }: { config: BounceWebhookConfig } & Omit<Props, "config">) {
  const { t } = useTranslation()
  const connected = webhookProvider(config.bounceWebhookProvider)
  const [providerId, setProviderId] = useState<WebhookProviderId | null>(connected?.id ?? null)
  const [secret, setSecret] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<"save" | "disconnect" | null>(null)

  const provider = webhookProvider(providerId)
  const url = webhookUrl(config.id, typeof window === "undefined" ? "" : window.location.origin)

  if (!supportsBounceWebhook(config.smtpHostname)) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{t("deliverability.webhookTitle")}</DialogTitle>
          <DialogDescription>{t("deliverability.webhookUnsupported")}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row justify-end">
          <Button variant="outline" onClick={onClose}>{t("common.close")}</Button>
        </DialogFooter>
      </>
    )
  }

  const save = async () => {
    if (!provider) return
    if (!secret.trim()) {
      setError(t("deliverability.webhookSecretRequired"))
      return
    }
    setBusy("save")
    setError(null)
    try {
      const res = await fetchApi(`/smtp-config/${config.id}/bounce-webhook`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: provider.id, secret: secret.trim() }),
      })
      if (res.status === 400) {
        setError(t(provider.invalid))
        return
      }
      if (!res.ok) throw new Error("save failed")
      toast.success(t("deliverability.webhookSaved"))
      onChanged(config.id, provider.id)
      onClose()
    } catch {
      toast.error(t("deliverability.webhookSaveFailed"))
    } finally {
      setBusy(null)
    }
  }

  const disconnect = async () => {
    setBusy("disconnect")
    try {
      const res = await fetchApi(`/smtp-config/${config.id}/bounce-webhook`, { method: "DELETE" })
      if (!res.ok) throw new Error("disconnect failed")
      toast.success(t("deliverability.webhookDisconnected"))
      onChanged(config.id, null)
      onClose()
    } catch {
      toast.error(t("deliverability.webhookDisconnectFailed"))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <DialogTitle>{t("deliverability.webhookTitle")}</DialogTitle>
          <Badge variant="outline" className={connected ? "text-success" : "text-muted-foreground"}>
            {connected ? t("deliverability.webhookConnected", { provider: connected.label }) : t("deliverability.webhookNotConnected")}
          </Badge>
        </div>
        <DialogDescription>{t("deliverability.webhookDescription")}</DialogDescription>
      </DialogHeader>

      <div className="flex max-h-[calc(85dvh-14rem)] flex-col gap-4 overflow-y-auto pr-2 [scrollbar-gutter:stable]">
        <Field>
          <FieldLabel htmlFor="webhook-provider">{t("deliverability.webhookProvider")}</FieldLabel>
          <Select
            value={providerId ?? ""}
            onValueChange={(value) => {
              if (typeof value !== "string") return
              setProviderId(webhookProvider(value)?.id ?? null)
              setError(null)
            }}
          >
            <SelectTrigger id="webhook-provider">
              <SelectValue>
                {provider?.label ?? <span className="text-muted-foreground">{t("deliverability.webhookProviderPlaceholder")}</span>}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {WEBHOOK_PROVIDERS.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel>{t("deliverability.webhookUrlLabel")}</FieldLabel>
          <CopyUrl value={url} />
          {provider && (
            <FieldDescription className="text-xs leading-snug sm:text-sm">{t(provider.steps)}</FieldDescription>
          )}
        </Field>

        {provider && (
          <Field data-invalid={error !== null}>
            <FieldLabel htmlFor="webhook-secret">{t(provider.secret)}</FieldLabel>
            <Input
              id="webhook-secret"
              type="password"
              value={secret}
              placeholder={t(provider.placeholder)}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              aria-invalid={error !== null}
              onChange={(e) => {
                setSecret(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => { if (e.key === "Enter" && busy === null) save() }}
            />
            {error ? (
              <FieldError>{error}</FieldError>
            ) : (
              connected?.id === provider.id && (
                <FieldDescription className="text-xs leading-snug sm:text-sm">{t("deliverability.webhookSecretSaved")}</FieldDescription>
              )
            )}
          </Field>
        )}
      </div>

      <DialogFooter className="flex-row flex-wrap justify-end">
        {connected && (
          <Button variant="outline" className="text-destructive" onClick={disconnect} disabled={busy !== null}>
            {busy === "disconnect" ? <LoaderIcon className="animate-spin" /> : <UnplugIcon />}
            {t("deliverability.webhookDisconnect")}
          </Button>
        )}
        <Button variant="outline" onClick={onClose}>{t("common.close")}</Button>
        <Button onClick={save} disabled={!provider || busy !== null}>
          {busy === "save" ? <LoaderIcon className="animate-spin" /> : <WebhookIcon />}
          {busy === "save" ? t("deliverability.webhookSaving") : t("deliverability.webhookSave")}
        </Button>
      </DialogFooter>
    </>
  )
}
