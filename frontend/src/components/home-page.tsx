import { LanguageSwitcher } from "@/components/language-switcher"
import { useDocumentTitle, useTranslation } from "@/i18n"

export function HomePage() {
  const { t } = useTranslation()
  useDocumentTitle("nav.title.home")
  return (
    <main className="relative flex min-h-screen items-center justify-center">
      <LanguageSwitcher className="absolute top-4 right-4" />
      <div className="text-center">
        <h1 className="text-4xl font-medium mb-4">MakiSend</h1>
        <p className="text-muted-foreground mb-6">{t("home.tagline")}</p>
        <a href="/login" className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          {t("home.openDashboard")}
        </a>
        <p className="mt-3 text-xs text-muted-foreground">{t("home.firstConnection")}</p>
      </div>
    </main>
  )
}
