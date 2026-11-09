import { Combobox } from "@base-ui/react/combobox"
import { cn } from "cn"
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react"
import { useTranslation } from "@/i18n"
import { PRESETS, PRESET_GROUP_LABEL, groupPresets, presetMatches, type SmtpPreset } from "@/lib/smtp-form"

const GROUPS = groupPresets(PRESETS)

interface Props {
  id: string
  value: SmtpPreset | null
  onChange: (preset: SmtpPreset | null) => void
}

/**
 * The provider field of the SMTP form: type to search (name, host or another name such as "aws",
 * "outlook" or "sendinblue"), or open the grouped list. Picking one fills the server fields; the
 * field stays optional and a provider that is not listed is simply typed in below.
 */
export function SmtpPresetPicker({ id, value, onChange }: Props) {
  const { t } = useTranslation()

  return (
    <Combobox.Root
      items={GROUPS}
      filter={presetMatches}
      itemToStringLabel={(item: SmtpPreset) => item.label}
      itemToStringValue={(item: SmtpPreset) => item.id}
      isItemEqualToValue={(item: SmtpPreset, selected: SmtpPreset) => item.id === selected.id}
      value={value}
      onValueChange={(next: SmtpPreset | null) => onChange(next)}
      autoHighlight
    >
      <div className="relative">
        <Combobox.Input
          id={id}
          placeholder={t("smtp.providerSearchPlaceholder")}
          autoComplete="off"
          spellCheck={false}
          className="h-11 w-full min-w-0 rounded-lg border border-input bg-transparent py-1 pr-18 pl-4 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
        />
        <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
          {value && (
            <Combobox.Clear
              aria-label={t("smtp.providerClear")}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <XIcon className="size-4" />
            </Combobox.Clear>
          )}
          <Combobox.Trigger
            aria-label={t("smtp.providerOpen")}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronDownIcon className="size-4" />
          </Combobox.Trigger>
        </div>
      </div>

      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} className="isolate z-50">
          <Combobox.Popup
            className={cn(
              "max-h-[min(var(--available-height),22rem)] w-(--anchor-width) origin-(--transform-origin) overflow-y-auto overscroll-contain rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100",
              "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            )}
          >
            <Combobox.Empty className="px-2 py-3 text-sm text-muted-foreground empty:hidden">
              {t("smtp.providerEmpty")}
            </Combobox.Empty>
            <Combobox.List>
              {(group: { group: SmtpPreset["group"]; items: SmtpPreset[] }) => (
                <Combobox.Group key={group.group} items={group.items} className="pb-1">
                  <Combobox.GroupLabel className="px-2 pt-2 pb-1 text-xs text-muted-foreground">
                    {t(PRESET_GROUP_LABEL[group.group])}
                  </Combobox.GroupLabel>
                  <Combobox.Collection>
                    {(item: SmtpPreset) => (
                      <Combobox.Item
                        key={item.id}
                        value={item}
                        className="relative flex cursor-default items-center gap-2 rounded-md py-2 pr-8 pl-2 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                      >
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{item.label}</span>
                          <span className="truncate font-mono text-xs text-muted-foreground">
                            {item.hostname}:{item.port}
                          </span>
                        </span>
                        <Combobox.ItemIndicator className="absolute right-2 flex size-4 items-center justify-center">
                          <CheckIcon className="size-4" />
                        </Combobox.ItemIndicator>
                      </Combobox.Item>
                    )}
                  </Combobox.Collection>
                </Combobox.Group>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}
