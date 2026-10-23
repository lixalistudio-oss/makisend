"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { ArrowUpCircleIcon, RefreshCwIcon, XIcon } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { fetchApi } from "@/lib/api"
import { useTranslation } from "@/i18n"

/** Shape of GET /updates/status (backend/src/updates/updates.types.ts). */
export interface UpdateStatus {
  enabled: boolean
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  releaseName: string | null
  releaseUrl: string | null
  releaseNotes: string | null
  publishedAt: string | null
  checkedAt: string | null
  error: string | null
  upstreamRepository: string
  syncWorkflowUrl: string | null
}

const UPDATE_GUIDE = "https://github.com/lixalistudio-oss/makisend/blob/main/docs/UPDATING.md"
/** "Later" hides the banner for this release only: the next one shows again. */
const DISMISS_KEY = "makisend:update-dismissed"

export async function loadUpdateStatus(refresh = false): Promise<UpdateStatus | null> {
  const res = await fetchApi(`/updates/status${refresh ? "?refresh=true" : ""}`)
  if (!res.ok) return null
  const data = await res.json().catch(() => null)
  return data?.status ?? null
}

function dismissed(version: string): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === version
  } catch {
    return false
  }
}

/**
 * Dashboard banner shown when a newer MakiSend release is published. "Update" explains the
 * two ways to install it: the instance's sync workflow (one click when MAKISEND_REPOSITORY is
 * set), or the manual steps of docs/UPDATING.md.
 */
export function UpdateBanner() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [hidden, setHidden] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    loadUpdateStatus()
      .then((s) => {
        setStatus(s)
        if (s?.latestVersion && dismissed(s.latestVersion)) setHidden(true)
      })
      .catch(() => setStatus(null))
  }, [])

  if (!status?.updateAvailable || !status.latestVersion || hidden) return null

  const later = () => {
    try {
      localStorage.setItem(DISMISS_KEY, status.latestVersion!)
    } catch {
      // Private mode: hide for this page view only.
    }
    setHidden(true)
  }

  return (
    <>
      <div
        role="status"
        className="flex flex-col gap-3 rounded-xl bg-brand-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex min-w-0 items-start gap-3">
          <ArrowUpCircleIcon className="mt-0.5 size-5 shrink-0 text-brand-strong" aria-hidden />
          <div className="min-w-0 text-sm">
            <p className="font-medium text-brand-strong">{t("updates.banner.available", { version: status.latestVersion })}</p>
            <p className="text-muted-foreground">
              {t("updates.banner.running", { version: status.currentVersion })}{" "}
              {status.releaseUrl && (
                <a className="text-brand underline-offset-4 hover:underline" href={status.releaseUrl} target="_blank" rel="noreferrer">
                  {t("updates.banner.whatsNew")}
                </a>
              )}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button onClick={() => setOpen(true)}>{t("updates.banner.update")}</Button>
          <Button variant="ghost" size="icon" aria-label={t("updates.banner.dismiss")} onClick={later}>
            <XIcon />
          </Button>
        </div>
      </div>
      <UpdateDialog status={status} open={open} onOpenChange={setOpen} />
    </>
  )
}

function UpdateDialog({
  status,
  open,
  onOpenChange,
}: {
  status: UpdateStatus
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("updates.dialog.title", { version: status.latestVersion ?? "" })}</DialogTitle>
          <DialogDescription>
            {t("updates.dialog.description")}
          </DialogDescription>
        </DialogHeader>

        {status.releaseNotes && (
          <pre className="max-h-60 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">
            {status.releaseNotes}
          </pre>
        )}

        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-muted-foreground">
          {status.syncWorkflowUrl ? (
            <>
              <li>{t("updates.dialog.syncStep1")}</li>
              <li>
                {t("updates.dialog.syncStep2Before")}
                <span className="text-foreground">{t("updates.dialog.syncStep2Action")}</span>
                {t("updates.dialog.syncStep2After")}
              </li>
              <li>{t("updates.dialog.syncStep3")}</li>
            </>
          ) : (
            <>
              <li>
                {t("updates.dialog.manualStep1Before")}
                <span className="text-foreground">{t("updates.dialog.manualStep1Workflow")}</span>
                {t("updates.dialog.manualStep1After")}
              </li>
              <li>
                {t("updates.dialog.manualStep2Before")}
                <code className="text-foreground">MAKISEND_REPOSITORY</code>
                {t("updates.dialog.manualStep2After")}
              </li>
            </>
          )}
        </ol>

        <DialogFooter>
          <a className={buttonVariants({ variant: "outline" })} href={UPDATE_GUIDE} target="_blank" rel="noreferrer">
            {t("updates.dialog.guide")}
          </a>
          {status.syncWorkflowUrl ? (
            <a className={buttonVariants()} href={status.syncWorkflowUrl} target="_blank" rel="noreferrer">
              {t("updates.dialog.openWorkflow")}
            </a>
          ) : (
            status.releaseUrl && (
              <a className={buttonVariants()} href={status.releaseUrl} target="_blank" rel="noreferrer">
                {t("updates.dialog.openRelease")}
              </a>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Settings card: running version, last check, "Check now". */
export function VersionCard() {
  const { t, locale } = useTranslation()
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    loadUpdateStatus().then(setStatus).catch(() => setStatus(null))
  }, [])

  const checkNow = useCallback(async () => {
    setChecking(true)
    try {
      const next = await loadUpdateStatus(true)
      setStatus(next)
      if (!next) toast.error(t("updates.version.checkFailedToast"))
      else if (next.error) toast.error(next.error)
      else if (next.updateAvailable) toast.success(t("updates.banner.available", { version: next.latestVersion ?? "" }))
      else toast.success(t("updates.version.latestToast"))
    } finally {
      setChecking(false)
    }
  }, [t])

  return (
    <div className="flex flex-col gap-3 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">{t("updates.version.installed")}</dt>
        <dd className="tabular-nums">{status?.currentVersion ?? "…"}</dd>
        <dt className="text-muted-foreground">{t("updates.version.latest")}</dt>
        <dd className="tabular-nums">
          {!status
            ? "…"
            : !status.enabled
              ? t("updates.version.checkOff")
              : status.latestVersion ?? t("updates.version.noneYet")}
          {status?.updateAvailable && <span className="ml-2 text-warning">{t("updates.version.updateAvailable")}</span>}
        </dd>
        <dt className="text-muted-foreground">{t("updates.version.lastCheck")}</dt>
        <dd>{status?.checkedAt ? new Date(status.checkedAt).toLocaleString(locale) : t("common.never")}</dd>
      </dl>
      {status?.error && <p className="text-destructive">{t("updates.version.lastCheckFailed", { error: status.error })}</p>}
      {status?.enabled && (
        <div>
          <Button variant="outline" onClick={checkNow} disabled={checking}>
            <RefreshCwIcon className={checking ? "animate-spin" : undefined} />
            {checking ? t("updates.version.checking") : t("updates.version.checkNow")}
          </Button>
        </div>
      )}
    </div>
  )
}
