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

interface Stats {
  totalSent: number
  successCount: number
  failureCount: number
  successRate: number
}

export function SectionCards() {
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

  const cards = [
    { title: "Total emails sent", value: stats?.totalSent ?? "—", description: "All time" },
    { title: "Delivered", value: stats?.successCount ?? "—", description: "Successfully sent" },
    { title: "Failed", value: stats?.failureCount ?? "—", description: "Delivery errors" },
    { title: "Delivery rate", value: `${stats?.successRate ?? 0}%`, description: "Success percentage" },
  ]

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title} className="@container/card min-w-0">
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
