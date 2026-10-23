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
import { useTranslation, type UiKey } from "@/i18n"

interface ErrorSummary {
  error: string
  count: number
}

const RANGE_OPTIONS: { value: string; labelKey: UiKey }[] = [
  { value: "7", labelKey: "dashboard.errors.last7Days" },
  { value: "30", labelKey: "dashboard.errors.last30Days" },
  { value: "90", labelKey: "dashboard.errors.last90Days" },
]

export function ErrorsCard() {
  const { t, locale } = useTranslation()
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
        <CardDescription>{t("dashboard.errors.description")}</CardDescription>
        <CardTitle className="text-xl font-medium">
          {t("dashboard.errors.title")}
        </CardTitle>
        <CardAction>
          <Select value={days} onValueChange={(v) => v && setDays(v)}>
            <SelectTrigger className="w-[140px]" size="sm">
              <SelectValue>
                {(value: string) => {
                  const option = RANGE_OPTIONS.find((opt) => opt.value === value)
                  return option ? t(option.labelKey) : value
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">{t("dashboard.errors.loading")}</p>
        ) : errors.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <InboxIcon className="size-4" />
            {t("dashboard.errors.empty")}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {errors.map((entry) => (
              <li
                key={entry.error}
                className="flex items-center justify-between gap-4 rounded-md border bg-card px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <CircleXIcon className="size-4 shrink-0 text-destructive" />
                  <span className="truncate text-sm" title={entry.error}>
                    {entry.error}
                  </span>
                </div>
                <Badge variant="outline" className="shrink-0 tabular-nums">
                  {entry.count.toLocaleString(locale)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
