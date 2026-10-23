"use client"

import { useEffect, useState } from "react"
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { fetchApi } from "@/lib/api"
import { useTranslation } from "@/i18n"

interface Stats {
  totalSent: number
  successCount: number
  failureCount: number
  successRate: number
}

export function SectionCards() {
  const { t, locale } = useTranslation()
  const [stats, setStats] = useState<Stats>({
    totalSent: 0,
    successCount: 0,
    failureCount: 0,
    successRate: 0,
  })

  useEffect(() => {
    fetchApi("/dashboard/stats")
      .then((res) => res.json())
      .then((data) => {
        if (data.stats) setStats(data.stats)
      })
      .catch(() => {})
  }, [])

  const count = (value: number | undefined) => (value == null ? "—" : value.toLocaleString(locale))
  const cards = [
    { id: "total", title: t("dashboard.cards.totalSent"), value: count(stats?.totalSent), description: t("dashboard.cards.totalSentDescription") },
    { id: "delivered", title: t("dashboard.cards.delivered"), value: count(stats?.successCount), description: t("dashboard.cards.deliveredDescription") },
    { id: "failed", title: t("dashboard.cards.failed"), value: count(stats?.failureCount), description: t("dashboard.cards.failedDescription") },
    {
      id: "rate",
      title: t("dashboard.cards.rate"),
      value: t("dashboard.cards.rateValue", { rate: (stats?.successRate ?? 0).toLocaleString(locale) }),
      description: t("dashboard.cards.rateDescription"),
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.id} className="@container/card min-w-0">
          <CardHeader>
            <CardDescription>{card.title}</CardDescription>
            <CardTitle className="font-heading text-[1.75rem] leading-tight font-medium tracking-[-0.03em] tabular-nums @[250px]/card:text-4xl">
              {card.value}
            </CardTitle>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="line-clamp-1 flex gap-2 text-muted-foreground">
              {card.description}
            </div>
          </CardFooter>
        </Card>
      ))}
    </div>
  )
}
