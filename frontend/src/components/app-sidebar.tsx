import * as React from "react"

import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUser } from "@/components/nav-user"
import { MakiSendMark } from "@/components/makisend-mark"
import { StarOnGitHub } from "@/components/star-on-github"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  LayoutDashboardIcon,
  MailIcon,
  KeyIcon,
  FileTextIcon,
  LayoutTemplateIcon,
  BookOpenIcon,
  Settings2Icon,
} from "lucide-react"
import type { UiKey } from "@/i18n"

const data: Record<"navMain" | "navSecondary", { titleKey: UiKey; url: string; icon: React.ReactNode }[]> = {
  navMain: [
    {
      titleKey: "nav.dashboard",
      url: "/dashboard",
      icon: <LayoutDashboardIcon />,
    },
    {
      titleKey: "nav.smtpConfig",
      url: "/dashboard/smtp-config",
      icon: <MailIcon />,
    },
    {
      titleKey: "nav.apiKeys",
      url: "/dashboard/api-keys",
      icon: <KeyIcon />,
    },
    {
      titleKey: "nav.emailLogs",
      url: "/dashboard/email-logs",
      icon: <FileTextIcon />,
    },
    {
      titleKey: "nav.templates",
      url: "/dashboard/templates",
      icon: <LayoutTemplateIcon />,
    },
  ],
  navSecondary: [
    {
      titleKey: "nav.apiReference",
      url: "/dashboard/api-docs",
      icon: <BookOpenIcon />,
    },
    {
      titleKey: "nav.settings",
      url: "/dashboard/settings",
      icon: <Settings2Icon />,
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[slot=sidebar-menu-button]:p-1.5!"
              render={<a href="/dashboard" />}
            >
              <MakiSendMark className="size-6!" />
              <span className="font-heading text-base font-medium tracking-tight">MakiSend</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <StarOnGitHub />
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
