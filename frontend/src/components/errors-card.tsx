"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CircleXIcon, InboxIcon } from "lucide-react"
import { fetchApi } from "@/lib/api"

interface ErrorSummary {
  error: string
  count: number
}

const RANGE_OPTIONS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
]

export function ErrorsCard() {
  const [errors, setErrors] = useState<ErrorSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState("7")

  useEffect(() => {
    setLoading(true)
    fetchApi(`/dashboard/errors?days=${days}`)
      .then((res) => res.json())
      .then((data) => setErrors(data.errors ?? []))
      .catch(() => setErrors([]))
      .finally(() => setLoading(false))
  }, [days])

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription>Delivery Errors</CardDescription>
        <CardTitle className="text-xl font-semibold">
          Top errors across all sends
        </CardTitle>
        <CardAction>
          <Select value={days} onValueChange={(v) => v && setDays(v)}>
            <SelectTrigger className="w-[140px]" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading errors...</p>
        ) : errors.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <InboxIcon className="size-4" />
            No delivery errors in this period.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {errors.map((entry) => (
              <li
                key={entry.error}
                className="flex items-center justify-between gap-4 rounded-md border bg-card px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <CircleXIcon className="size-4 shrink-0 fill-red-500 text-red-600" />
                  <span className="truncate text-sm" title={entry.error}>
                    {entry.error}
                  </span>
                </div>
                <Badge variant="outline" className="shrink-0 tabular-nums">
                  {entry.count}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
