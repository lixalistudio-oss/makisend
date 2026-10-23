import * as React from "react"

import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUser } from "@/components/nav-user"
import { MakiSendMark } from "@/components/makisend-mark"
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

const data = {
  navMain: [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: <LayoutDashboardIcon />,
    },
    {
      title: "SMTP configuration",
      url: "/dashboard/smtp-config",
      icon: <MailIcon />,
    },
    {
      title: "API keys",
      url: "/dashboard/api-keys",
      icon: <KeyIcon />,
    },
    {
      title: "Email logs",
      url: "/dashboard/email-logs",
      icon: <FileTextIcon />,
    },
    {
      title: "Templates",
      url: "/dashboard/templates",
      icon: <LayoutTemplateIcon />,
    },
  ],
  navSecondary: [
    {
      title: "API reference",
      url: "/dashboard/api-docs",
      icon: <BookOpenIcon />,
    },
    {
      title: "Settings",
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
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
