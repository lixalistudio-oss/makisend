"use client"

import * as React from "react"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { isCurrent, usePathname } from "@/lib/nav"
import { useTranslation, type UiKey } from "@/i18n"

export function NavSecondary({
  items,
  ...props
}: {
  items: {
    titleKey: UiKey
    url: string
    icon: React.ReactNode
  }[]
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  const pathname = usePathname()
  const { t } = useTranslation()
  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.url}>
              <SidebarMenuButton isActive={isCurrent(item.url, pathname)} render={<a href={item.url} aria-current={isCurrent(item.url, pathname) ? "page" : undefined} />}>
                {item.icon}
                <span>{t(item.titleKey)}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
