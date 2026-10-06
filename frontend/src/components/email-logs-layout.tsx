import { useState, useEffect } from "react"
import { Toaster } from "sonner"
import { toast } from "sonner"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SessionGuard } from "@/components/session-guard"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
  DrawerFooter,
} from "@/components/ui/drawer"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  CircleCheckIcon,
  CircleXIcon,
  LoaderIcon,
  MailIcon,
  SearchIcon,
} from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"
import { fetchApi } from "@/lib/api"

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
  smtpId: string | null
  sentAt: string | null
  createdAt: string
  emailProcessingTimeMs: number | null
  history: HistoryEntry[]
}

interface SmtpConfig {
  id: string
  smtpHostname: string
}

const statusConfig: Record<string, { color: string; icon: React.ReactNode }> = {
  received: { color: "text-blue-600 bg-blue-50", icon: <MailIcon className="size-3" /> },
  processing: { color: "text-yellow-600 bg-yellow-50", icon: <LoaderIcon className="size-3 animate-spin" /> },
  cleaned: { color: "text-indigo-600 bg-indigo-50", icon: <CircleCheckIcon className="size-3" /> },
  sent: { color: "text-green-600 bg-green-50", icon: <CircleCheckIcon className="fill-green-500 size-3" /> },
  attempt_failed: { color: "text-orange-600 bg-orange-50", icon: <CircleXIcon className="fill-orange-500 size-3" /> },
  failed: { color: "text-red-600 bg-red-50", icon: <CircleXIcon className="fill-red-500 size-3" /> },
  unknown: { color: "text-muted-foreground bg-muted", icon: <LoaderIcon className="size-3" /> },
}

function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] ?? statusConfig.unknown
  return (
    <Badge variant="outline" className={`gap-1 px-1.5 ${config.color}`}>
      {config.icon}
      {status}
    </Badge>
  )
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return "—"
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function EmailLogsLayout() {
  const isMobile = useIsMobile()
  const [logs, setLogs] = useState<EmailLog[]>([])
  const [configs, setConfigs] = useState<SmtpConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState("all")
  const [configFilter, setConfigFilter] = useState("all")
  const [search, setSearch] = useState("")
  const [selectedLog, setSelectedLog] = useState<EmailLog | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const fetchLogs = async () => {
    try {
      const params = new URLSearchParams()
      if (statusFilter !== "all") params.set("status", statusFilter)
      if (configFilter !== "all") params.set("smtpConfigId", configFilter)
      if (search) params.set("to", search)

      const qs = params.toString()
      const [logsRes, configsRes] = await Promise.all([
        fetchApi(`/email-logs${qs ? `?${qs}` : ""}`),
        fetchApi("/smtp-config"),
      ])
      const logsData = await logsRes.json()
      const configsData = await configsRes.json()
      setLogs(logsData.logs ?? [])
      setConfigs(configsData.configs ?? [])
    } catch {
      toast.error("Failed to load email logs")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLogs()
  }, [statusFilter, configFilter])

  const handleSearch = () => {
    fetchLogs()
  }

  const openDetail = (log: EmailLog) => {
    setSelectedLog(log)
    setDrawerOpen(true)
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <Toaster position="top-right" />
      <SidebarInset>
        <SiteHeader />
        <SessionGuard>
        <div className="flex flex-1 flex-col gap-6 p-6">
          <div>
            <h2 className="text-2xl font-bold">Email Logs</h2>
            <p className="text-sm text-muted-foreground">
              Track the status and history of all sent emails.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search by recipient..."
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
            </div>
            <Button variant="outline" onClick={handleSearch}>Search</Button>
            <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="received">Received</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="cleaned">Cleaned</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={configFilter} onValueChange={(v) => v && setConfigFilter(v)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="SMTP Config" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Configs</SelectItem>
                {configs.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.smtpHostname}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-hidden rounded-lg border">
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
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      <LoaderIcon className="size-6 animate-spin text-muted-foreground mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      No email logs found.
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => {
                    const latestStatus = log.history[log.history.length - 1]?.status ?? "unknown"
                    return (
                      <TableRow
                        key={log.internalId}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => openDetail(log)}
                      >
                        <TableCell className="font-medium">{log.to}</TableCell>
                        <TableCell className="max-w-[250px] truncate">{log.subject}</TableCell>
                        <TableCell>
                          <StatusBadge status={latestStatus} />
                        </TableCell>
                        <TableCell>{formatDate(log.sentAt ?? log.createdAt)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {log.emailProcessingTimeMs ? `${log.emailProcessingTimeMs}ms` : "—"}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>

          <Drawer
            open={drawerOpen}
            onOpenChange={setDrawerOpen}
            swipeDirection={isMobile ? "down" : "right"}
          >
            <DrawerContent>
              {selectedLog && (
                <>
                  <DrawerHeader className="gap-1">
                    <DrawerTitle>{selectedLog.subject}</DrawerTitle>
                    <DrawerDescription>{selectedLog.to}</DrawerDescription>
                  </DrawerHeader>
                  <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Duration</span>
                      <span>{selectedLog.emailProcessingTimeMs ? `${selectedLog.emailProcessingTimeMs}ms` : "—"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">
                        {selectedLog.sentAt ? "Sent At" : "Queued At"}
                      </span>
                      <span>{formatDate(selectedLog.sentAt ?? selectedLog.createdAt)}</span>
                    </div>
                    {selectedLog.smtpId && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">SMTP ID</span>
                        <span className="max-w-[60%] truncate font-mono text-xs">{selectedLog.smtpId}</span>
                      </div>
                    )}
                    <div className="border-t pt-4">
                      <h4 className="font-medium mb-3">Email Timeline</h4>
                      <div className="relative ml-2 border-l-2 border-muted pl-4">
                        {selectedLog.history.map((entry, i) => (
                          <div key={i} className="relative mb-4 last:mb-0">
                            <div className={`absolute -left-[21px] top-1 size-3 rounded-full border-2 border-background ${statusConfig[entry.status]?.color ?? "bg-muted"}`} />
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-2">
                                <StatusBadge status={entry.status} />
                                <span className="text-xs text-muted-foreground">{formatTime(entry.createdAt)}</span>
                                {entry.attempts != null && entry.attempts > 0 && (
                                  <span className="text-xs text-muted-foreground">
                                    attempt {entry.attempts}
                                  </span>
                                )}
                              </div>
                              {entry.error && (
                                <p className="text-xs text-destructive">{entry.error}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <DrawerFooter>
                    <DrawerClose render={<Button variant="outline" />}>Close</DrawerClose>
                  </DrawerFooter>
                </>
              )}
            </DrawerContent>
          </Drawer>
        </div>
        </SessionGuard>
      </SidebarInset>
    </SidebarProvider>
  )
}
