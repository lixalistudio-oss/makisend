import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { isCurrent, usePathname } from "@/lib/nav"
import { useTranslation, type UiKey } from "@/i18n"

export function NavMain({
  items,
}: {
  items: {
    titleKey: UiKey
    url: string
    icon?: React.ReactNode
  }[]
}) {
  const pathname = usePathname()
  const { t } = useTranslation()
  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.url}>
              <SidebarMenuButton tooltip={t(item.titleKey)} isActive={isCurrent(item.url, pathname)} render={<a href={item.url} aria-current={isCurrent(item.url, pathname) ? "page" : undefined} />}>
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
