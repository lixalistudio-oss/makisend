import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Toaster } from "@/components/ui/sonner"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SessionGuard } from "@/components/session-guard"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { KeyIcon } from "lucide-react"
import { fetchApi } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useTheme } from "@/lib/theme"
import { THEME_OPTIONS } from "@/components/theme-options"
import { TwoFactorCard } from "@/components/two-factor-card"
import { VersionCard } from "@/components/update-banner"
import { useTranslation } from "@/i18n"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null)
  return data?.message || data?.error || fallback
}

export function SettingsLayout() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  const [email, setEmail] = useState("")
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [deletePassword, setDeletePassword] = useState("")
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    fetchApi("/api/auth/get-session")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const user = data?.data?.user ?? data?.user
        if (user?.email) setEmail(user.email)
      })
      .catch(() => {})
  }, [])

  const handleSaveProfile = async () => {
    const target = email.trim()

    if (!EMAIL_RE.test(target)) {
      toast.error(t("settings.errorInvalidEmail"))
      return
    }

    setSavingProfile(true)
    try {
      const res = await fetchApi("/api/auth/change-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newEmail: target }),
      })

      if (!res.ok) {
        toast.error(await readErrorMessage(res, t("settings.errorUpdateEmail")))
        return
      }

      setEmail(target)
      toast.success(t("settings.emailUpdated"))
    } catch {
      toast.error(t("settings.networkError"))
    } finally {
      setSavingProfile(false)
    }
  }

  const handleChangePassword = async () => {
    if (!currentPassword) {
      toast.error(t("settings.errorCurrentPasswordRequired"))
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error(t("settings.errorPasswordsMismatch"))
      return
    }
    if (newPassword.length < 8) {
      toast.error(t("settings.errorPasswordTooShort"))
      return
    }

    setSavingPassword(true)
    try {
      const res = await fetchApi("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      })

      if (!res.ok) {
        toast.error(await readErrorMessage(res, t("settings.errorChangePassword")))
        return
      }

      toast.success(t("settings.passwordChanged"))
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
    } catch {
      toast.error(t("settings.networkError"))
    } finally {
      setSavingPassword(false)
    }
  }

  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      toast.error(t("settings.errorDeletePasswordRequired"))
      return
    }

    setDeleting(true)
    try {
      const res = await fetchApi("/api/auth/delete-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: deletePassword }),
      })

      if (!res.ok) {
        toast.error(await readErrorMessage(res, t("settings.errorDeleteAccount")))
        return
      }

      setDeleteOpen(false)
      toast.success(t("settings.accountDeleted"))
      window.location.href = "/login"
    } catch {
      toast.error(t("settings.networkError"))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <Toaster position="top-right" />
      <SidebarInset>
        <SiteHeader titleKey="nav.settings" />
        <SessionGuard>
        <div className="flex flex-1 flex-col gap-8 p-4 sm:p-6 max-w-2xl">
          <div>
            <h2 className="font-heading text-[1.75rem] leading-tight font-medium tracking-[-0.03em]">{t("settings.title")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("settings.subtitle")}
            </p>
          </div>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>{t("settings.appearanceTitle")}</CardTitle>
                <CardDescription>
                  {t("settings.appearanceDescription")}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 sm:grid-cols-3">
                {THEME_OPTIONS.map((option) => {
                  const Icon = option.icon
                  const active = theme === option.value
                  return (
                    <Button
                      key={option.value}
                      type="button"
                      variant="outline"
                      aria-pressed={active}
                      onClick={() => setTheme(option.value)}
                      className={cn(
                        "h-11 justify-start gap-2",
                        active && "border-brand/40 bg-brand-subtle text-brand-strong hover:bg-brand-subtle dark:border-brand/40 dark:bg-brand-subtle dark:hover:bg-brand-subtle",
                      )}
                    >
                      <Icon />
                      {t(option.labelKey)}
                    </Button>
                  )
                })}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {t("settings.appearanceHint")}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>{t("settings.emailTitle")}</CardTitle>
                <CardDescription>
                  {t("settings.emailDescription")}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <FieldGroup className="gap-4">
                <Field>
                  <FieldLabel htmlFor="email">{t("settings.emailLabel")}</FieldLabel>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="name@example.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <FieldDescription>
                    {t("settings.emailHint")}
                  </FieldDescription>
                </Field>
                <div>
                  <Button onClick={handleSaveProfile} disabled={savingProfile}>
                    {savingProfile ? t("settings.saving") : t("settings.saveChanges")}
                  </Button>
                </div>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <KeyIcon className="size-5 text-muted-foreground" />
                <div>
                  <CardTitle>{t("settings.passwordTitle")}</CardTitle>
                  <CardDescription>
                    {t("settings.passwordDescription")}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <FieldGroup className="gap-4">
                <Field>
                  <FieldLabel htmlFor="currentPassword">{t("settings.currentPassword")}</FieldLabel>
                  <Input
                    id="currentPassword"
                    type="password"
                    autoComplete="current-password"
                    placeholder={t("settings.currentPasswordPlaceholder")}
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                  <FieldDescription>
                    {t("settings.currentPasswordHint")}
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="newPassword">{t("settings.newPassword")}</FieldLabel>
                  <Input
                    id="newPassword"
                    type="password"
                    autoComplete="new-password"
                    placeholder={t("settings.newPasswordPlaceholder")}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                  <FieldDescription>
                    {t("settings.newPasswordHint")}
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="confirmPassword">{t("settings.confirmNewPassword")}</FieldLabel>
                  <Input
                    id="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    placeholder={t("settings.confirmNewPasswordPlaceholder")}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                  <FieldDescription>
                    {t("settings.confirmNewPasswordHint")}
                  </FieldDescription>
                </Field>
                <div>
                  <Button onClick={handleChangePassword} disabled={savingPassword}>
                    {savingPassword ? t("settings.changing") : t("settings.changePassword")}
                  </Button>
                </div>
              </FieldGroup>
            </CardContent>
          </Card>

          <TwoFactorCard />

          <Card>
            <CardHeader>
              <CardTitle>{t("settings.versionTitle")}</CardTitle>
              <CardDescription>
                {t("settings.versionDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <VersionCard />
            </CardContent>
          </Card>

          <Card className="ring-destructive/40">
            <CardHeader>
              <CardTitle>{t("settings.deleteAccount")}</CardTitle>
              <CardDescription>
                {t("settings.deleteDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <DialogTrigger render={<Button variant="destructive" />}>
                  {t("settings.deleteAccount")}
                </DialogTrigger>
                <DialogContent className="sm:max-w-[425px]">
                  <DialogHeader>
                    <DialogTitle>{t("settings.deleteConfirmTitle")}</DialogTitle>
                    <DialogDescription>
                      {t("settings.deleteConfirmDescription")}
                    </DialogDescription>
                  </DialogHeader>
                  <Field>
                    <FieldLabel htmlFor="deletePassword">{t("settings.currentPassword")}</FieldLabel>
                    <Input
                      id="deletePassword"
                      type="password"
                      autoComplete="current-password"
                      placeholder={t("settings.currentPasswordPlaceholder")}
                      required
                      value={deletePassword}
                      onChange={(e) => setDeletePassword(e.target.value)}
                    />
                    <FieldDescription>
                      {t("settings.deletePasswordHint")}
                    </FieldDescription>
                  </Field>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                      {t("common.cancel")}
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleDeleteAccount}
                      disabled={deleting}
                    >
                      {deleting ? t("settings.deleting") : t("settings.deleteConfirmButton")}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>
        </div>
        </SessionGuard>
      </SidebarInset>
    </SidebarProvider>
  )
}
