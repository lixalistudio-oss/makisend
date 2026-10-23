import { useEffect, useState } from "react"
import QRCode from "qrcode"
import { toast } from "sonner"
import { ShieldCheckIcon } from "lucide-react"
import { fetchApi } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

type SessionUser = { twoFactorEnabled?: boolean | null; totpPasswordless?: boolean | null }

/** Set up while enabling: shown once, before the first code confirms the authenticator. */
type Pending = { qr: string; secret: string; backupCodes: string[] }

async function post(path: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> | null }> {
  const res = await fetchApi(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return { ok: res.ok, data: await res.json().catch(() => null) }
}

const errorOf = (data: Record<string, unknown> | null, fallback: string) =>
  (data?.message as string) || (data?.error as string) || fallback

function BackupCodes({ codes }: { codes: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-3 font-mono text-sm">
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Each code works once, if you lose your authenticator. Store them now: they are not shown again.
      </p>
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigator.clipboard.writeText(codes.join("\n")).then(() => toast.success("Backup codes copied"))}
        >
          Copy codes
        </Button>
      </div>
    </div>
  )
}

/**
 * Settings > Two-factor authentication: TOTP with any authenticator app (Google Authenticator,
 * 1Password, Authy...), backup codes, and the opt-in sign-in with email + code only.
 * Every change asks for the password.
 */
export function TwoFactorCard() {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [pending, setPending] = useState<Pending | null>(null)
  const [freshCodes, setFreshCodes] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = () =>
    fetchApi("/api/auth/get-session")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setUser(data?.user ?? null))
      .catch(() => {})

  useEffect(() => {
    refresh()
  }, [])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
    } catch {
      toast.error("Network error. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  const requirePassword = () => {
    if (password) return true
    toast.error("Enter your current password")
    return false
  }

  const startEnable = () =>
    requirePassword() &&
    run(async () => {
      const { ok, data } = await post("/api/auth/two-factor/enable", { password })
      if (!ok) return void toast.error(errorOf(data, "Could not start two-factor set-up"))
      const uri = String(data!.totpURI)
      setPending({
        qr: await QRCode.toDataURL(uri, { margin: 1, width: 192 }),
        secret: new URL(uri).searchParams.get("secret") ?? "",
        backupCodes: (data!.backupCodes as string[]) ?? [],
      })
      setPassword("")
      setCode("")
    })

  const confirmEnable = () =>
    run(async () => {
      const { ok, data } = await post("/api/auth/two-factor/verify-totp", { code: code.trim() })
      if (!ok) return void toast.error(errorOf(data, "Invalid code"))
      setFreshCodes(pending?.backupCodes ?? null)
      setPending(null)
      setCode("")
      toast.success("Two-factor authentication is on")
      await refresh()
    })

  const disable = () =>
    requirePassword() &&
    run(async () => {
      const { ok, data } = await post("/api/auth/two-factor/disable", { password })
      if (!ok) return void toast.error(errorOf(data, "Could not turn two-factor authentication off"))
      setPassword("")
      setFreshCodes(null)
      toast.success("Two-factor authentication is off")
      await refresh()
    })

  const regenerateCodes = () =>
    requirePassword() &&
    run(async () => {
      const { ok, data } = await post("/api/auth/two-factor/generate-backup-codes", { password })
      if (!ok) return void toast.error(errorOf(data, "Could not generate new backup codes"))
      setFreshCodes((data!.backupCodes as string[]) ?? [])
      setPassword("")
      toast.success("New backup codes generated. The old ones no longer work.")
    })

  const setPasswordless = (enabled: boolean) =>
    requirePassword() &&
    run(async () => {
      const { ok, data } = await post("/api/auth/two-factor/passwordless", { enabled, password })
      if (!ok) return void toast.error(errorOf(data, "Could not change the sign-in method"))
      setPassword("")
      toast.success(enabled ? "You can now sign in with an authenticator code only" : "Password required again to sign in")
      await refresh()
    })

  const enabled = !!user?.twoFactorEnabled

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldCheckIcon className="size-5 text-muted-foreground" />
          <div>
            <CardTitle className="flex items-center gap-2">
              Two-factor authentication
              <Badge variant={enabled ? "default" : "outline"}>{enabled ? "On" : "Off"}</Badge>
            </CardTitle>
            <CardDescription>
              Asks for a 6-digit code from an authenticator app (Google Authenticator, 1Password, Authy...)
              after your password.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <FieldGroup className="gap-4">
          {pending ? (
            <>
              <div className="flex flex-col items-start gap-3">
                <img src={pending.qr} alt="QR code to scan with your authenticator app" className="rounded-md border" />
                <FieldDescription>
                  Scan this QR code with your authenticator app, or enter this key by hand:{" "}
                  <code className="break-all font-mono text-xs">{pending.secret}</code>
                </FieldDescription>
              </div>
              <BackupCodes codes={pending.backupCodes} />
              <Field>
                <FieldLabel htmlFor="totp-confirm">Code from the app</FieldLabel>
                <Input
                  id="totp-confirm"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
                <FieldDescription>Two-factor authentication turns on once this code is accepted.</FieldDescription>
              </Field>
              <div className="flex gap-2">
                <Button onClick={confirmEnable} disabled={busy || code.trim().length !== 6}>
                  {busy ? "Checking..." : "Confirm and turn on"}
                </Button>
                <Button variant="outline" onClick={() => setPending(null)} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              {freshCodes && <BackupCodes codes={freshCodes} />}
              {enabled && (
                <Field>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={!!user?.totpPasswordless}
                      disabled={busy}
                      onChange={(e) => setPasswordless(e.target.checked)}
                    />
                    <span>
                      Sign in without a password
                      <span className="block text-muted-foreground">
                        Your email and a code from the authenticator app are enough. The code becomes your
                        only factor: keep the app's device locked.
                      </span>
                    </span>
                  </label>
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="totp-password">Current password</FieldLabel>
                <Input
                  id="totp-password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Your current password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <FieldDescription>Required to change any two-factor setting.</FieldDescription>
              </Field>
              <div className="flex flex-wrap gap-2">
                {enabled ? (
                  <>
                    <Button variant="outline" onClick={regenerateCodes} disabled={busy}>
                      New backup codes
                    </Button>
                    <Button variant="destructive" onClick={disable} disabled={busy}>
                      Turn off
                    </Button>
                  </>
                ) : (
                  <Button onClick={startEnable} disabled={busy}>
                    {busy ? "Preparing..." : "Set up two-factor authentication"}
                  </Button>
                )}
              </div>
            </>
          )}
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
