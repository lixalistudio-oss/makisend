import { useEffect, useState } from "react"
import { toast } from "sonner"
import { LoaderIcon, TrashIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { fetchApi } from "@/lib/api"
import { useTranslation } from "@/i18n"
import { describeSuppression, type Suppression } from "@/lib/deliverability"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Settings > Suppression list: the addresses POST /send-email refuses. Filled by hard bounces
 * (the recipient's server said the address does not exist) and by hand; removing an entry
 * allows sending to it again.
 */
export function SuppressionsCard() {
  const { t, locale } = useTranslation()
  const [entries, setEntries] = useState<Suppression[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  const load = async () => {
    try {
      const res = await fetchApi("/suppressions")
      if (!res.ok) throw new Error("load failed")
      const data = (await res.json()) as { suppressions?: Suppression[] }
      setEntries(data.suppressions ?? [])
    } catch {
      toast.error(t("deliverability.suppressionLoadFailed"))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const add = async () => {
    const target = email.trim()
    if (!EMAIL_RE.test(target)) {
      setError(t("deliverability.suppressionInvalidEmail"))
      return
    }
    setAdding(true)
    setError(null)
    try {
      const res = await fetchApi("/suppressions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: target }),
      })
      if (res.status === 400) {
        setError(t("deliverability.suppressionInvalidEmail"))
        return
      }
      if (!res.ok) throw new Error("add failed")
      const data = (await res.json()) as { created?: boolean }
      toast.success(data.created ? t("deliverability.suppressionAdded") : t("deliverability.suppressionAlready"))
      setEmail("")
      await load()
    } catch {
      setError(t("deliverability.suppressionAddFailed"))
    } finally {
      setAdding(false)
    }
  }

  const remove = async (entry: Suppression) => {
    setRemoving(entry.id)
    try {
      const res = await fetchApi(`/suppressions/${entry.id}`, { method: "DELETE" })
      if (!res.ok && res.status !== 404) throw new Error("remove failed")
      setEntries((current) => current.filter((e) => e.id !== entry.id))
      toast.success(t("deliverability.suppressionRemoved"))
    } catch {
      toast.error(t("deliverability.suppressionRemoveFailed"))
    } finally {
      setRemoving(null)
    }
  }

  const formatDate = (iso: string) => new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("deliverability.suppressionsTitle")}</CardTitle>
        <CardDescription>{t("deliverability.suppressionsDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <form
          noValidate
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            add()
          }}
        >
          <Field data-invalid={!!error} className="min-w-0 flex-1">
            <FieldLabel htmlFor="suppression-email">{t("deliverability.suppressionEmailLabel")}</FieldLabel>
            <Input
              id="suppression-email"
              type="email"
              autoComplete="off"
              placeholder={t("deliverability.suppressionEmailPlaceholder")}
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(null) }}
              aria-invalid={!!error}
            />
            {error && <FieldError>{error}</FieldError>}
          </Field>
          <Button type="submit" disabled={adding || !email.trim()} className={error ? "sm:mb-7" : undefined}>
            {adding && <LoaderIcon className="animate-spin" />}
            {adding ? t("deliverability.suppressionAdding") : t("deliverability.suppressionAdd")}
          </Button>
        </form>

        {loading ? (
          <div className="flex justify-center py-6">
            <LoaderIcon className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("deliverability.suppressionEmpty")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-xl border">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 p-4">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate font-mono text-sm">{entry.email}</span>
                    <Badge variant="outline" className={entry.source === "bounce" ? "text-warning" : "text-muted-foreground"}>
                      {entry.source === "bounce" ? t("deliverability.sourceBounce") : t("deliverability.sourceManual")}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{describeSuppression(entry, t)}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">{t("deliverability.addedOn", { date: formatDate(entry.createdAt) })}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 shrink-0"
                  aria-label={t("deliverability.suppressionRemove", { email: entry.email })}
                  disabled={removing === entry.id}
                  onClick={() => remove(entry)}
                >
                  {removing === entry.id ? <LoaderIcon className="animate-spin" /> : <TrashIcon />}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
