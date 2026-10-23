"use client"

import { useEffect, useState } from "react"
import {
  CircleCheckIcon,
  CircleXIcon,
  LoaderIcon,
  MailIcon,
} from "lucide-react"

import { fetchApi } from "@/lib/api"
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
  const variants: Record<string, { icon: React.ReactNode; className: string }> = {
    received: {
      icon: <MailIcon className="size-3" />,
      className: "text-muted-foreground",
    },
    processing: {
      icon: <LoaderIcon className="size-3 animate-spin motion-reduce:animate-none" />,
      className: "text-brand-strong",
    },
    cleaned: {
      icon: <CircleCheckIcon className="size-3" />,
      className: "text-muted-foreground",
    },
    sent: {
      icon: <CircleCheckIcon />,
      className: "text-success",
    },
    delivered: {
      icon: <CircleCheckIcon />,
      className: "text-success",
    },
    attempt_failed: {
      icon: <CircleXIcon />,
      className: "text-warning",
    },
    failed: {
      icon: <CircleXIcon />,
      className: "text-destructive",
    },
    unknown: {
      icon: <LoaderIcon className="size-3" />,
      className: "text-muted-foreground",
    },
  }

  const v = variants[status] ?? variants.unknown

  return (
    <Badge variant="outline" className={`gap-1 px-1.5 ${v.className}`}>
      {v.icon}
      {status}
    </Badge>
  )
}

export function DataTable() {
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
        Loading email logs...
      </div>
    )
  }

  if (logs.length === 0) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground">
        No emails sent yet.
      </div>
    )
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Recipient</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Duration</TableHead>
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
                  {new Date(sentOrCreated).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {log.emailProcessingTimeMs
                    ? `${log.emailProcessingTimeMs}ms`
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
