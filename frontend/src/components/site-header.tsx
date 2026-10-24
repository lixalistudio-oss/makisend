import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { LanguageSwitcher } from "@/components/language-switcher"
import { ThemeToggle } from "@/components/theme-toggle"
import { useDocumentTitle, useTranslation, type UiKey } from "@/i18n"

const DOCUMENT_TITLES: Partial<Record<UiKey, UiKey>> = {
  "nav.dashboard": "nav.title.dashboard",
  "nav.smtpConfig": "nav.title.smtpConfig",
  "nav.apiKeys": "nav.title.apiKeys",
  "nav.emailLogs": "nav.title.emailLogs",
  "nav.templates": "nav.title.templates",
  "nav.apiReference": "nav.title.apiDocs",
  "nav.settings": "nav.title.settings",
}

/** The page header; it also keeps the tab title and `<html lang>` in the current language. */
export function SiteHeader({ titleKey = "nav.dashboard" }: { titleKey?: UiKey }) {
  const { t } = useTranslation()
  useDocumentTitle(DOCUMENT_TITLES[titleKey] ?? "nav.title.dashboard")
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-2 px-4 py-3 lg:gap-3 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 h-4 data-vertical:self-auto"
        />
        <h1 className="text-base font-medium">{t(titleKey)}</h1>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  )
}
