import { useEffect, useState } from "react"
import { StarIcon, XIcon } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { useTranslation } from "@/i18n"

/** Always the upstream project, not the instance's own copy: stars go where the project lives. */
export const UPSTREAM_REPOSITORY_URL = "https://github.com/lixalistudio-oss/makisend"
const DISMISS_KEY = "makisend:star-dismissed"

/**
 * A small card in the sidebar asking to star the project on GitHub. A plain link: no star count,
 * so the dashboard makes no request to GitHub (the same reason `UPDATE_CHECK=off` exists).
 * Closing it hides it for good on this browser.
 */
export function StarOnGitHub() {
  const { t } = useTranslation()
  // Hidden until mounted: the server HTML cannot know whether it was dismissed.
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      setVisible(window.localStorage.getItem(DISMISS_KEY) === null)
    } catch {
      setVisible(true)
    }
  }, [])

  if (!visible) return null

  const dismiss = () => {
    setVisible(false)
    try {
      window.localStorage.setItem(DISMISS_KEY, "1")
    } catch {
      // storage disabled: hidden for this page only
    }
  }

  return (
    <div className="relative rounded-xl border bg-card p-3 text-sm text-card-foreground">
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("star.dismiss")}
        title={t("star.dismiss")}
        className="absolute top-2 right-2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <XIcon className="size-3.5" />
      </button>
      <p className="pr-6 font-medium">{t("star.title")}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t("star.body")}</p>
      <a
        href={UPSTREAM_REPOSITORY_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonVariants({ variant: "outline", size: "sm", className: "mt-3 w-full" })}
      >
        <StarIcon />
        {t("star.action")}
      </a>
    </div>
  )
}
