"use client"

import { useEffect, useState } from "react"
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleXIcon,
  ClockIcon,
  LoaderIcon,
  MailIcon,
} from "lucide-react"

import { fetchApi } from "@/lib/api"
import { useTranslation, type UiKey } from "@/i18n"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface HistoryEntry {
  status: string
  error: string | null
  attempts: number | null
  createdAt: string
}

interface EmailLog {
  internalId: string
  to: string
  subject: string
  sentAt: string | null
  createdAt: string
  emailProcessingTimeMs: number | null
  history: HistoryEntry[]
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation()
  const variants: Record<string, { icon: React.ReactNode; className: string; labelKey: UiKey }> = {
    received: {
      labelKey: "dashboard.status.received",
      icon: <MailIcon className="size-3" />,
      className: "text-muted-foreground",
    },
    processing: {
      labelKey: "dashboard.status.processing",
      icon: <LoaderIcon className="size-3 animate-spin motion-reduce:animate-none" />,
      className: "text-brand-strong",
    },
    cleaned: {
      labelKey: "dashboard.status.cleaned",
      icon: <CircleCheckIcon className="size-3" />,
      className: "text-muted-foreground",
    },
    sent: {
      labelKey: "dashboard.status.sent",
      icon: <CircleCheckIcon />,
      className: "text-success",
    },
    delivered: {
      labelKey: "dashboard.status.delivered",
      icon: <CircleCheckIcon />,
      className: "text-success",
    },
    attempt_failed: {
      labelKey: "dashboard.status.attemptFailed",
      icon: <CircleXIcon />,
      className: "text-warning",
    },
    failed: {
      labelKey: "dashboard.status.failed",
      icon: <CircleXIcon />,
      className: "text-destructive",
    },
    deferred: {
      labelKey: "dashboard.status.deferred",
      icon: <ClockIcon />,
      className: "text-warning",
    },
    bounced: {
      labelKey: "dashboard.status.bounced",
      icon: <CircleXIcon />,
      className: "text-destructive",
    },
    complained: {
      labelKey: "dashboard.status.complained",
      icon: <CircleAlertIcon />,
      className: "text-destructive",
    },
    unknown: {
      labelKey: "dashboard.status.unknown",
      icon: <LoaderIcon className="size-3" />,
      className: "text-muted-foreground",
    },
  }

  const v = variants[status]
  const config = v ?? variants.unknown

  return (
    <Badge variant="outline" className={`gap-1 px-1.5 ${config.className}`}>
      {config.icon}
      {/* A status the UI does not know yet stays as the server sent it. */}
      {v ? t(v.labelKey) : status}
    </Badge>
  )
}

export function DataTable() {
  const { t, locale } = useTranslation()
  const [logs, setLogs] = useState<EmailLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchApi("/email-logs")
      .then((res) => res.json())
      .then((data) => {
        setLogs(data.logs ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground">
        {t("dashboard.table.loading")}
      </div>
    )
  }

  if (logs.length === 0) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground">
        {t("dashboard.table.empty")}
      </div>
    )
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("dashboard.table.recipient")}</TableHead>
            <TableHead>{t("dashboard.table.subject")}</TableHead>
            <TableHead>{t("dashboard.table.status")}</TableHead>
            <TableHead>{t("dashboard.table.date")}</TableHead>
            <TableHead className="text-right">{t("dashboard.table.duration")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map((log) => {
            // Status lives only in history[] — last entry is the latest state.
            const latestStatus =
              log.history[log.history.length - 1]?.status ?? "unknown"
            const sentOrCreated = log.sentAt ?? log.createdAt

            return (
              <TableRow key={log.internalId}>
                <TableCell className="font-medium">{log.to}</TableCell>
                <TableCell className="max-w-[300px] truncate">
                  {log.subject}
                </TableCell>
                <TableCell>
                  <StatusBadge status={latestStatus} />
                </TableCell>
                <TableCell>
                  {new Date(sentOrCreated).toLocaleDateString(locale, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {log.emailProcessingTimeMs
                    ? t("dashboard.table.durationValue", { ms: log.emailProcessingTimeMs.toLocaleString(locale) })
                    : "—"}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
