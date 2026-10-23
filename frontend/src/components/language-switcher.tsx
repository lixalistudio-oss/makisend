import { CheckIcon, LanguagesIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LANGUAGES, useTranslation } from "@/i18n"

/**
 * Every language at once, each named in its own language (an endonym is not a translation key);
 * only the control's accessible name is translated. The current language is written out, so
 * nobody has to open the menu to know where they are.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { t, lang, setLanguage } = useTranslation()
  const currentName = LANGUAGES.find((l) => l.code === lang)?.nativeName ?? lang

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" className={className} aria-label={`${t("common.language")}: ${currentName}`} />}
      >
        <LanguagesIcon />
        <span>{currentName}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        {LANGUAGES.map((option) => (
          <DropdownMenuItem
            key={option.code}
            lang={option.code}
            aria-current={option.code === lang ? "true" : undefined}
            onClick={() => setLanguage(option.code)}
          >
            <span className="flex-1">{option.nativeName}</span>
            {option.code === lang ? <CheckIcon className="size-4" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
