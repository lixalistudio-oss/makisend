"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { MailIcon, CheckCircleIcon, XCircleIcon, TrendingUpIcon } from "lucide-react"
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
    {
      title: "Total Emails Sent",
      value: stats?.totalSent ?? "—",
      description: "All time",
      icon: <MailIcon className="size-4" />,
      trend: null,
    },
    {
      title: "Delivered",
      value: stats?.successCount ?? "—",
      description: "Successfully sent",
      icon: <CheckCircleIcon className="size-4" />,
      trend: { value: `${stats?.successRate ?? 0}%`, up: true },
    },
    {
      title: "Failed",
      value: stats?.failureCount ?? "—",
      description: "Delivery errors",
      icon: <XCircleIcon className="size-4" />,
      trend: null,
    },
    {
      title: "Delivery Rate",
      value: `${stats?.successRate ?? 0}%`,
      description: "Success percentage",
      icon: <TrendingUpIcon className="size-4" />,
      trend: null,
    },
  ]

  return (
    <div className="grid grid-cols-4 gap-4 px-4 *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 dark:*:data-[slot=card]:bg-card">
      {cards.map((card) => (
        <Card key={card.title} className="@container/card">
          <CardHeader>
            <CardDescription>{card.title}</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {card.value}
            </CardTitle>
            {card.trend && (
              <CardAction>
                <Badge variant="outline">
                  {card.trend.up ? <TrendingUpIcon /> : null}
                  {card.trend.value}
                </Badge>
              </CardAction>
            )}
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="line-clamp-1 flex gap-2 font-medium">
              {card.description}
            </div>
          </CardFooter>
        </Card>
      ))}
    </div>
  )
}
