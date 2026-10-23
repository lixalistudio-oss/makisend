"use client"

import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"

import { useIsMobile } from "@/hooks/use-mobile"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"
import { fetchApi } from "@/lib/api"
import { useTranslation } from "@/i18n"


interface LogEntry {
  date: string
  sent: number
  failed: number
}

export function ChartAreaInteractive() {
  const isMobile = useIsMobile()
  const { t, locale } = useTranslation()
  const chartConfig = React.useMemo(
    () =>
      ({
        sent: {
          label: t("dashboard.chart.sent"),
          color: "var(--brand)",
        },
        failed: {
          label: t("dashboard.chart.failed"),
          color: "var(--destructive)",
        },
      }) satisfies ChartConfig,
    [t],
  )
  const [timeRange, setTimeRange] = React.useState("30d")
  const [chartData, setChartData] = React.useState<LogEntry[]>([])

  React.useEffect(() => {
    if (isMobile) {
      setTimeRange("7d")
    }
  }, [isMobile])

  React.useEffect(() => {
    const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90
    fetchApi(`/dashboard/stats?days=${days}`)
      .then((res) => res.json())
      .then((data) => {
        const stats = data.stats
        const today = new Date()
        const entries: LogEntry[] = []
        for (let i = days - 1; i >= 0; i--) {
          const d = new Date(today)
          d.setDate(d.getDate() - i)
          entries.push({
            date: d.toISOString().split("T")[0],
            sent: 0,
            failed: 0,
          })
        }
        // The API returns window totals only, so the chart spreads them evenly over the days
        // (a per-day series needs a backend endpoint). "Sent" counts delivered emails, not
        // every attempt: drawing totalSent here showed failures as green deliveries.
        if (stats && stats.totalSent > 0) {
          const perDay = Math.ceil((stats.successCount ?? 0) / days)
          const failPerDay = Math.ceil((stats.failureCount ?? 0) / days)
          entries.forEach((e) => {
            e.sent = perDay
            e.failed = failPerDay
          })
        }
        setChartData(entries)
      })
      .catch(() => {})
  }, [timeRange])

  const filteredData = chartData.filter((item) => {
    const date = new Date(item.date)
    const referenceDate = new Date()
    let daysToSubtract = 90
    if (timeRange === "30d") daysToSubtract = 30
    else if (timeRange === "7d") daysToSubtract = 7
    const startDate = new Date(referenceDate)
    startDate.setDate(startDate.getDate() - daysToSubtract)
    return date >= startDate
  })

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("dashboard.chart.title")}</CardTitle>
        <CardDescription>
          <span className="hidden @[540px]/card:block">
            {t("dashboard.chart.description")}
          </span>
          <span className="@[540px]/card:hidden">{t("dashboard.chart.descriptionShort")}</span>
        </CardDescription>
        <CardAction>
          <ToggleGroup
            multiple={false}
            value={timeRange ? [timeRange] : []}
            onValueChange={(value) => {
              setTimeRange(value[0] ?? "30d")
            }}
            variant="outline"
            className="hidden *:data-[slot=toggle-group-item]:px-4! @[767px]/card:flex"
          >
            <ToggleGroupItem value="90d">{t("dashboard.chart.last3Months")}</ToggleGroupItem>
            <ToggleGroupItem value="30d">{t("dashboard.chart.last30Days")}</ToggleGroupItem>
            <ToggleGroupItem value="7d">{t("dashboard.chart.last7Days")}</ToggleGroupItem>
          </ToggleGroup>
          <Select
            value={timeRange}
            onValueChange={(value) => {
              if (value !== null) {
                setTimeRange(value)
              }
            }}
          >
            <SelectTrigger
              className="flex w-40 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden"
              size="sm"
              aria-label={t("dashboard.chart.rangeLabel")}
            >
              <SelectValue placeholder={t("dashboard.chart.last30Days")}>
                {(value: string) =>
                  value === "90d"
                    ? t("dashboard.chart.last3Months")
                    : value === "7d"
                      ? t("dashboard.chart.last7Days")
                      : t("dashboard.chart.last30Days")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="90d" className="rounded-lg">
                {t("dashboard.chart.last3Months")}
              </SelectItem>
              <SelectItem value="30d" className="rounded-lg">
                {t("dashboard.chart.last30Days")}
              </SelectItem>
              <SelectItem value="7d" className="rounded-lg">
                {t("dashboard.chart.last7Days")}
              </SelectItem>
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-[250px] w-full"
        >
          <AreaChart data={filteredData}>
            <defs>
              <linearGradient id="fillSent" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-sent)"
                  stopOpacity={1.0}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-sent)"
                  stopOpacity={0.1}
                />
              </linearGradient>
              <linearGradient id="fillFailed" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-failed)"
                  stopOpacity={0.8}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-failed)"
                  stopOpacity={0.1}
                />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={(value) => {
                const date = new Date(value)
                return date.toLocaleDateString(locale, {
                  month: "short",
                  day: "numeric",
                })
              }}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => {
                    return new Date(value).toLocaleDateString(locale, {
                      month: "short",
                      day: "numeric",
                    })
                  }}
                  indicator="dot"
                />
              }
            />
            <Area
              dataKey="failed"
              type="natural"
              fill="url(#fillFailed)"
              stroke="var(--color-failed)"
              stackId="a"
            />
            <Area
              dataKey="sent"
              type="natural"
              fill="url(#fillSent)"
              stroke="var(--color-sent)"
              stackId="a"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
