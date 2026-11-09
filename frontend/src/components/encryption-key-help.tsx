import { useCallback, useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { LanguageSwitcher } from "@/components/language-switcher"
import { ThemeToggle } from "@/components/theme-toggle"
import { useDocumentTitle, useTranslation } from "@/i18n"
import { fetchSetupStatus, type ConfigError } from "@/lib/instance-status"

const OPENSSL_COMMAND = "openssl rand -hex 32"
const NODE_COMMAND = `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
const WRANGLER_COMMAND = "npx wrangler secret put ENCRYPTION_KEY"

/** 32 random bytes as 64 hex characters: the same key `openssl rand -hex 32` prints. */
function generateKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

/** A command or a secret in Geist Mono on a muted panel, with a copy button confirming in place. */
function CodeBlock({ value, label }: { value: string; label?: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl bg-muted p-2 pl-4">
      <code className="block min-w-0 flex-1 font-mono text-[13px] break-all" aria-label={label}>
        {value}
      </code>
      <Button type="button" variant="outline" size="sm" onClick={copy}>
        {copied ? t("encryptionKey.copied") : t("encryptionKey.copy")}
      </Button>
    </div>
  )
}

type State =
  | { kind: "loading" }
  | { kind: "ok"; needsSetup: boolean }
  | { kind: "broken"; error: ConfigError }
  | { kind: "unreachable" }

/**
 * Shown instead of the sign-in page when the Worker's `ENCRYPTION_KEY` is missing or malformed
 * (`GET /api/setup-status` reports `configError`): what is wrong, how to generate a key, where to
 * put it, and a check that sends the owner on once the secret is fixed.
 */
export function EncryptionKeyHelp({ className, ...props }: React.ComponentProps<"div">) {
  const { t } = useTranslation()
  useDocumentTitle("nav.title.encryptionKey")
  const [state, setState] = useState<State>({ kind: "loading" })
  const [checking, setChecking] = useState(false)
  const [stillBroken, setStillBroken] = useState(false)
  const [generated, setGenerated] = useState<string | null>(null)

  const check = useCallback(async () => {
    const status = await fetchSetupStatus()
    if (!status) return setState({ kind: "unreachable" })
    if (status.configError) return setState({ kind: "broken", error: status.configError })
    setState({ kind: "ok", needsSetup: status.needsSetup })
  }, [])

  useEffect(() => {
    void check()
  }, [check])

  const checkAgain = async () => {
    setChecking(true)
    setStillBroken(false)
    const status = await fetchSetupStatus()
    setChecking(false)
    if (status && !status.configError) {
      window.location.replace(status.needsSetup ? "/setup" : "/login")
      return
    }
    setStillBroken(true)
    setState(status?.configError ? { kind: "broken", error: status.configError } : { kind: "unreachable" })
  }

  if (state.kind === "loading") return null

  const header = (
    <div className="mb-3 flex justify-end gap-1">
      <ThemeToggle />
      <LanguageSwitcher />
    </div>
  )

  if (state.kind === "ok") {
    return (
      <div className={cn("w-full max-w-md", className)} {...props}>
        {header}
        <Card className="p-0">
          <CardContent className="flex flex-col items-center gap-4 p-6 text-center md:p-8">
            <h1 className="text-2xl font-medium">{t("encryptionKey.okTitle")}</h1>
            <p className="text-sm text-balance text-muted-foreground">{t("encryptionKey.okDescription")}</p>
            <a href={state.needsSetup ? "/setup" : "/login"} className={buttonVariants({ className: "w-full" })}>
              {t("encryptionKey.goToSignIn")}
            </a>
          </CardContent>
        </Card>
      </div>
    )
  }

  const error = state.kind === "broken" ? state.error : null
  const variables = error?.variables ?? ["ENCRYPTION_KEY"]
  const summary =
    error?.code === "ENCRYPTION_KEY_MISSING"
      ? t("encryptionKey.missing")
      : t("encryptionKey.invalid", { variables: variables.join(", ") })
  const previousIsWrong = variables.includes("ENCRYPTION_KEY_PREVIOUS")

  return (
    <div className={cn("w-full max-w-2xl", className)} {...props}>
      {header}
      <Card className="p-0">
        <CardContent className="flex flex-col gap-8 p-6 md:p-8">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-medium">{t("encryptionKey.title")}</h1>
            {error ? (
              <p className="text-sm text-destructive">{summary}</p>
            ) : (
              <p className="text-sm text-destructive">{t("encryptionKey.unreachable")}</p>
            )}
            {previousIsWrong && <p className="text-sm text-muted-foreground">{t("encryptionKey.previousHint")}</p>}
          </div>

          <section className="flex flex-col gap-3">
            <h2 className="text-base font-medium">{t("encryptionKey.step1Title")}</h2>
            <p className="text-sm text-muted-foreground">{t("encryptionKey.step1Description")}</p>
            <CodeBlock value={OPENSSL_COMMAND} />
            <p className="text-sm text-muted-foreground">{t("encryptionKey.step1Alternatives")}</p>
            <CodeBlock value={NODE_COMMAND} />
            <p className="text-sm text-muted-foreground">{t("encryptionKey.generateHere")}</p>
            {generated ? (
              <CodeBlock value={generated} label="ENCRYPTION_KEY" />
            ) : (
              <div>
                <Button type="button" variant="outline" onClick={() => setGenerated(generateKey())}>
                  {t("encryptionKey.generate")}
                </Button>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-base font-medium">{t("encryptionKey.step2Title")}</h2>
            <p className="text-sm text-muted-foreground">{t("encryptionKey.step2Dashboard")}</p>
            <p className="text-sm text-muted-foreground">{t("encryptionKey.step2Cli")}</p>
            <CodeBlock value={WRANGLER_COMMAND} />
            <p className="text-sm text-muted-foreground">{t("encryptionKey.step2Local")}</p>
            <CodeBlock value={`ENCRYPTION_KEY=${generated ?? "<your 64-character key>"}`} />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-base font-medium">{t("encryptionKey.step3Title")}</h2>
            <p className="text-sm text-muted-foreground">{t("encryptionKey.step3Description")}</p>
            <div className="rounded-xl bg-muted p-4">
              <p className="text-sm font-medium text-warning">{t("encryptionKey.warningTitle")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("encryptionKey.warningDescription")}</p>
            </div>
          </section>

          <div className="flex flex-col gap-2">
            <Button type="button" className="w-full" onClick={checkAgain} disabled={checking}>
              {checking ? t("encryptionKey.checking") : t("encryptionKey.checkAgain")}
            </Button>
            {stillBroken && (
              <p className="text-center text-sm text-muted-foreground" role="status">
                {state.kind === "unreachable" ? t("encryptionKey.unreachable") : t("encryptionKey.stillInvalid")}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
