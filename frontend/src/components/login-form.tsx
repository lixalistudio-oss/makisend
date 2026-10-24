import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { fetchApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useDocumentTitle, useTranslation } from "@/i18n";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * - "password": email + password; when two-factor is on, the server answers `twoFactorRedirect`
 *   and the form moves to "second-factor".
 * - "second-factor": the authenticator code (or a backup code) completing that sign-in.
 * - "code": email + authenticator code, no password. Only works for an account that turned it
 *   on in Settings; the server answers the same error otherwise.
 */
type Step = "password" | "second-factor" | "code";

async function readError(res: Response, fallback: string) {
  const data = await res.json().catch(() => null);
  return data?.message || data?.error || fallback;
}

const post = (path: string, body: unknown) =>
  fetchApi(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const { t } = useTranslation();
  useDocumentTitle("nav.title.login");
  const [step, setStep] = useState<Step>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // No account yet: the first connection sets the instance up.
  useEffect(() => {
    fetchApi("/api/setup-status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { needsSetup: boolean } | null) => {
        if (data?.needsSetup) window.location.replace("/setup");
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (step === "password") {
        const res = await post("/api/auth/sign-in/email", { email, password });
        if (!res.ok) {
          setError(await readError(res, t("auth.errorInvalidCredentials")));
          return;
        }
        const data = await res.json().catch(() => null);
        if (data?.twoFactorRedirect) {
          setCode("");
          setStep("second-factor");
          return;
        }
        window.location.href = "/dashboard";
        return;
      }

      if (step === "second-factor") {
        const path = useBackupCode ? "/api/auth/two-factor/verify-backup-code" : "/api/auth/two-factor/verify-totp";
        const res = await post(path, { code: code.trim(), trustDevice });
        if (!res.ok) {
          setError(await readError(res, t("auth.errorInvalidCode")));
          return;
        }
        window.location.href = "/dashboard";
        return;
      }

      const res = await post("/api/auth/sign-in/totp", { email, code: code.trim() });
      if (!res.ok) {
        setError(await readError(res, t("auth.errorInvalidEmailOrCode")));
        return;
      }
      window.location.href = "/dashboard";
    } catch {
      setError(t("auth.networkError"));
    } finally {
      setLoading(false);
    }
  };

  const switchTo = (next: Step) => {
    setError(null);
    setCode("");
    setStep(next);
  };

  const backup = useBackupCode && step === "second-factor";
  const subtitle = {
    password: t("auth.subtitlePassword"),
    "second-factor": useBackupCode
      ? t("auth.subtitleBackupCode")
      : t("auth.subtitleTotp"),
    code: t("auth.subtitleCode"),
  }[step];

  return (
    <div className={cn("w-full max-w-md", className)} {...props}>
      <div className="mb-3 flex justify-end gap-1">
        <ThemeToggle />
        <LanguageSwitcher />
      </div>
      <Card className="p-0">
        <CardContent className="p-6 md:p-8">
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <div className="flex flex-col items-center gap-2 text-center">
                <h1 className="text-2xl font-medium">
                  {step === "second-factor" ? t("auth.twoFactorTitle") : t("auth.welcomeBack")}
                </h1>
                <p className="text-sm text-balance text-muted-foreground">{subtitle}</p>
              </div>

              {error && (
                <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              {step !== "second-factor" && (
                <Field>
                  <FieldLabel htmlFor="email">{t("auth.email")}</FieldLabel>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="username"
                    placeholder="m@example.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
              )}

              {step === "password" && (
                <Field>
                  <FieldLabel htmlFor="password">{t("auth.password")}</FieldLabel>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
              )}

              {step !== "password" && (
                <Field>
                  <FieldLabel htmlFor="code">{backup ? t("auth.backupCode") : t("auth.authenticatorCode")}</FieldLabel>
                  <Input
                    id="code"
                    autoComplete="one-time-code"
                    inputMode={backup ? "text" : "numeric"}
                    pattern={backup ? undefined : "[0-9]{6}"}
                    maxLength={backup ? 32 : 6}
                    placeholder={backup ? "xxxxx-xxxxx" : "123456"}
                    required
                    autoFocus
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </Field>
              )}

              {step === "second-factor" && (
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" checked={trustDevice} onChange={(e) => setTrustDevice(e.target.checked)} />
                  {t("auth.trustDevice")}
                </label>
              )}

              <Field>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? t("auth.signingIn") : step === "second-factor" ? t("auth.verify") : t("auth.signIn")}
                </Button>
              </Field>

              <FieldDescription className="text-center">
                {step === "password" && (
                  <button type="button" className="text-brand underline-offset-4 hover:underline" onClick={() => switchTo("code")}>
                    {t("auth.useCodeInstead")}
                  </button>
                )}
                {step === "code" && (
                  <button type="button" className="text-brand underline-offset-4 hover:underline" onClick={() => switchTo("password")}>
                    {t("auth.usePasswordInstead")}
                  </button>
                )}
                {step === "second-factor" && (
                  <button
                    type="button"
                    className="text-brand underline-offset-4 hover:underline"
                    onClick={() => {
                      setUseBackupCode(!useBackupCode);
                      setCode("");
                      setError(null);
                    }}
                  >
                    {useBackupCode ? t("auth.useAuthenticator") : t("auth.useBackupCode")}
                  </button>
                )}
              </FieldDescription>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
