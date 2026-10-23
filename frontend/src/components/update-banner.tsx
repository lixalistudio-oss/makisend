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
            <p className="font-medium text-brand-strong">MakiSend {status.latestVersion} is available</p>
            <p className="text-muted-foreground">
              You run {status.currentVersion}.{" "}
              {status.releaseUrl && (
                <a className="text-brand underline-offset-4 hover:underline" href={status.releaseUrl} target="_blank" rel="noreferrer">
                  What's new
                </a>
              )}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button onClick={() => setOpen(true)}>Update</Button>
          <Button variant="ghost" size="icon" aria-label="Remind me at the next release" onClick={later}>
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Update to {status.latestVersion}</DialogTitle>
          <DialogDescription>
            Your instance deploys from your own copy of the MakiSend repository. Updating merges the
            release into it; Cloudflare then rebuilds the Worker and applies the database migrations.
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
              <li>Open the sync workflow of your repository.</li>
              <li>
                Select <span className="text-foreground">Run workflow</span>, leave the version empty for the latest release.
              </li>
              <li>Wait for the Cloudflare build to finish, then reload this page.</li>
            </>
          ) : (
            <>
              <li>
                In your copy of the repository, run the <span className="text-foreground">Sync with upstream</span> workflow
                (Actions tab), or merge the release by hand.
              </li>
              <li>
                Set <code className="text-foreground">MAKISEND_REPOSITORY</code> on the Worker to make this button open it directly.
              </li>
            </>
          )}
        </ol>

        <DialogFooter>
          <a className={buttonVariants({ variant: "outline" })} href={UPDATE_GUIDE} target="_blank" rel="noreferrer">
            Update guide
          </a>
          {status.syncWorkflowUrl ? (
            <a className={buttonVariants()} href={status.syncWorkflowUrl} target="_blank" rel="noreferrer">
              Open the sync workflow
            </a>
          ) : (
            status.releaseUrl && (
              <a className={buttonVariants()} href={status.releaseUrl} target="_blank" rel="noreferrer">
                Open the release
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
      if (!next) toast.error("Could not check for updates")
      else if (next.error) toast.error(next.error)
      else if (next.updateAvailable) toast.success(`MakiSend ${next.latestVersion} is available`)
      else toast.success("You run the latest release")
    } finally {
      setChecking(false)
    }
  }, [])

  return (
    <div className="flex flex-col gap-3 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">Installed</dt>
        <dd className="tabular-nums">{status?.currentVersion ?? "…"}</dd>
        <dt className="text-muted-foreground">Latest release</dt>
        <dd className="tabular-nums">
          {!status
            ? "…"
            : !status.enabled
              ? "Check turned off (UPDATE_CHECK=off)"
              : status.latestVersion ?? "None published yet"}
          {status?.updateAvailable && <span className="ml-2 text-warning">Update available</span>}
        </dd>
        <dt className="text-muted-foreground">Last check</dt>
        <dd>{status?.checkedAt ? new Date(status.checkedAt).toLocaleString() : "Never"}</dd>
      </dl>
      {status?.error && <p className="text-destructive">Last check failed: {status.error}</p>}
      {status?.enabled && (
        <div>
          <Button variant="outline" onClick={checkNow} disabled={checking}>
            <RefreshCwIcon className={checking ? "animate-spin" : undefined} />
            {checking ? "Checking" : "Check now"}
          </Button>
        </div>
      )}
    </div>
  )
}
