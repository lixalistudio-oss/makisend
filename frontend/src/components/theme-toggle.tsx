import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { THEME_OPTIONS } from "@/components/theme-options";
import { useTranslation } from "@/i18n";
import { isTheme, useTheme } from "@/lib/theme";

/** The three choices, for menus that already have their own trigger (the user menu). */
export function ThemeMenuItems() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenuRadioGroup
      value={theme}
      onValueChange={(value) => {
        if (isTheme(value)) setTheme(value);
      }}
    >
      {THEME_OPTIONS.map((option) => {
        const Icon = option.icon;
        return (
          <DropdownMenuRadioItem key={option.value} value={option.value}>
            <Icon />
            <span>{t(option.labelKey)}</span>
          </DropdownMenuRadioItem>
        );
      })}
    </DropdownMenuRadioGroup>
  );
}

/**
 * Light, dark or the device's own setting (the default). Kept next to the language switcher
 * on every surface, from the landing page to the dashboard header.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const current = THEME_OPTIONS.find((option) => option.value === theme) ?? THEME_OPTIONS[2];
  const CurrentIcon = current.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className={className}
            aria-label={`${t("common.theme")}: ${t(current.labelKey)}`}
          />
        }
      >
        <CurrentIcon />
        <span className="hidden sm:inline">{t(current.labelKey)}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        <ThemeMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
