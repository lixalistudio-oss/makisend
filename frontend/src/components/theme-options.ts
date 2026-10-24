import { MonitorIcon, MoonIcon, SunIcon, type LucideIcon } from "lucide-react";
import type { UiKey } from "@/i18n";
import type { Theme } from "@/lib/theme";

export const THEME_OPTIONS: ReadonlyArray<{
  value: Theme;
  labelKey: UiKey;
  icon: LucideIcon;
}> = [
  { value: "light", labelKey: "common.themeLight", icon: SunIcon },
  { value: "dark", labelKey: "common.themeDark", icon: MoonIcon },
  { value: "system", labelKey: "common.themeSystem", icon: MonitorIcon },
];
