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
          setError(await readError(res, "Invalid email or password"));
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
          setError(await readError(res, "Invalid code"));
          return;
        }
        window.location.href = "/dashboard";
        return;
      }

      const res = await post("/api/auth/sign-in/totp", { email, code: code.trim() });
      if (!res.ok) {
        setError(await readError(res, "Invalid email or authenticator code"));
        return;
      }
      window.location.href = "/dashboard";
    } catch {
      setError("Network error. Please try again.");
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
    password: "Sign in to your MakiSend account",
    "second-factor": useBackupCode
      ? "Enter one of your backup codes"
      : "Enter the 6-digit code from your authenticator app",
    code: "Sign in with your email and the code from your authenticator app",
  }[step];

  return (
    <div className={cn("w-full max-w-md", className)} {...props}>
      <Card className="p-0">
        <CardContent className="p-6 md:p-8">
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <div className="flex flex-col items-center gap-2 text-center">
                <h1 className="text-2xl font-medium">
                  {step === "second-factor" ? "Two-factor authentication" : "Welcome back"}
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
                  <FieldLabel htmlFor="email">Email</FieldLabel>
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
                  <FieldLabel htmlFor="password">Password</FieldLabel>
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
                  <FieldLabel htmlFor="code">{backup ? "Backup code" : "Authenticator code"}</FieldLabel>
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
                  Trust this device for 30 days
                </label>
              )}

              <Field>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Signing in..." : step === "second-factor" ? "Verify" : "Sign in"}
                </Button>
              </Field>

              <FieldDescription className="text-center">
                {step === "password" && (
                  <button type="button" className="text-brand underline-offset-4 hover:underline" onClick={() => switchTo("code")}>
                    Sign in with an authenticator code instead
                  </button>
                )}
                {step === "code" && (
                  <button type="button" className="text-brand underline-offset-4 hover:underline" onClick={() => switchTo("password")}>
                    Sign in with your password instead
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
                    {useBackupCode ? "Use your authenticator app" : "Use a backup code"}
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
