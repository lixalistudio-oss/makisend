import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SectionCards } from "@/components/section-cards"
import { ChartAreaInteractive } from "@/components/chart-area-interactive"
import { ErrorsCard } from "@/components/errors-card"
import { DataTable } from "@/components/data-table"
import { SessionGuard } from "@/components/session-guard"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"

export function DashboardLayout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <SessionGuard>
          <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
            <div className="pt-4">
              <SectionCards />
            </div>
            <ChartAreaInteractive />
            <ErrorsCard />
            <DataTable />
          </div>
        </SessionGuard>
      </SidebarInset>
    </SidebarProvider>
  )
}
