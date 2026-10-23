import { useEffect, useState } from "react"
import { Toaster } from "sonner"
import { toast } from "sonner"
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
import { TwoFactorCard } from "@/components/two-factor-card"
import { VersionCard } from "@/components/update-banner"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null)
  return data?.message || data?.error || fallback
}

export function SettingsLayout() {
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
      toast.error("Enter a valid email address, e.g. name@example.com")
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
        toast.error(await readErrorMessage(res, "Could not update the email address"))
        return
      }

      setEmail(target)
      toast.success("Email address updated")
    } catch {
      toast.error("Network error. Please try again.")
    } finally {
      setSavingProfile(false)
    }
  }

  const handleChangePassword = async () => {
    if (!currentPassword) {
      toast.error("Enter your current password")
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match")
      return
    }
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters")
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
        toast.error(await readErrorMessage(res, "Could not change the password"))
        return
      }

      toast.success("Password changed successfully")
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
    } catch {
      toast.error("Network error. Please try again.")
    } finally {
      setSavingPassword(false)
    }
  }

  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      toast.error("Enter your current password to confirm deletion")
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
        toast.error(await readErrorMessage(res, "Could not delete the account"))
        return
      }

      setDeleteOpen(false)
      toast.success("Account deleted")
      window.location.href = "/login"
    } catch {
      toast.error("Network error. Please try again.")
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
            <h2 className="font-heading text-[1.75rem] leading-tight font-medium tracking-[-0.03em]">Settings</h2>
            <p className="text-sm text-muted-foreground">
              Manage your account settings and preferences.
            </p>
          </div>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Email</CardTitle>
                <CardDescription>
                  The email address you sign in with. Expects an email address.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <FieldGroup className="gap-4">
                <Field>
                  <FieldLabel htmlFor="email">Email address</FieldLabel>
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
                    Must be a valid email address, e.g. name@example.com.
                  </FieldDescription>
                </Field>
                <div>
                  <Button onClick={handleSaveProfile} disabled={savingProfile}>
                    {savingProfile ? "Saving..." : "Save changes"}
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
                  <CardTitle>Password</CardTitle>
                  <CardDescription>
                    Change your account password. Every field below expects a password.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <FieldGroup className="gap-4">
                <Field>
                  <FieldLabel htmlFor="currentPassword">Current password</FieldLabel>
                  <Input
                    id="currentPassword"
                    type="password"
                    autoComplete="current-password"
                    placeholder="Your current password"
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                  <FieldDescription>
                    The password you use to sign in right now.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="newPassword">New password</FieldLabel>
                  <Input
                    id="newPassword"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Your new password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                  <FieldDescription>
                    Must be at least 8 characters long.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="confirmPassword">Confirm new password</FieldLabel>
                  <Input
                    id="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Repeat the new password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                  <FieldDescription>
                    Type the new password again to confirm it.
                  </FieldDescription>
                </Field>
                <div>
                  <Button onClick={handleChangePassword} disabled={savingPassword}>
                    {savingPassword ? "Changing..." : "Change password"}
                  </Button>
                </div>
              </FieldGroup>
            </CardContent>
          </Card>

          <TwoFactorCard />

          <Card>
            <CardHeader>
              <CardTitle>MakiSend version</CardTitle>
              <CardDescription>
                Checked once a day against the latest release on GitHub. Set UPDATE_CHECK=off to never contact GitHub.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <VersionCard />
            </CardContent>
          </Card>

          <Card className="ring-destructive/40">
            <CardHeader>
              <CardTitle>Delete account</CardTitle>
              <CardDescription>
                This action is irreversible. All your SMTP configs, API keys, and email logs will be permanently deleted.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <DialogTrigger render={<Button variant="destructive" />}>
                  Delete account
                </DialogTrigger>
                <DialogContent className="sm:max-w-[425px]">
                  <DialogHeader>
                    <DialogTitle>Are you absolutely sure?</DialogTitle>
                    <DialogDescription>
                      This action cannot be undone. This will permanently delete your account and remove all your data from our servers.
                    </DialogDescription>
                  </DialogHeader>
                  <Field>
                    <FieldLabel htmlFor="deletePassword">Current password</FieldLabel>
                    <Input
                      id="deletePassword"
                      type="password"
                      autoComplete="current-password"
                      placeholder="Your current password"
                      required
                      value={deletePassword}
                      onChange={(e) => setDeletePassword(e.target.value)}
                    />
                    <FieldDescription>
                      Enter your current password to confirm. This expects a password, not an email.
                    </FieldDescription>
                  </Field>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleDeleteAccount}
                      disabled={deleting}
                    >
                      {deleting ? "Deleting..." : "Yes, delete my account"}
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
