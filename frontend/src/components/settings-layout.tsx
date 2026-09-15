import { useState } from "react"
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

export function SettingsLayout() {
  const [email, setEmail] = useState("test@example.com")
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [deleteOpen, setDeleteOpen] = useState(false)

  const handleSaveProfile = () => {
    toast.success("Profile updated successfully")
  }

  const handleChangePassword = () => {
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match")
      return
    }
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters")
      return
    }
    toast.success("Password changed successfully")
    setCurrentPassword("")
    setNewPassword("")
    setConfirmPassword("")
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <Toaster position="top-right" />
      <SidebarInset>
        <SiteHeader />
        <SessionGuard>
        <div className="flex flex-1 flex-col gap-8 p-6 max-w-2xl">
          <div>
            <h2 className="text-2xl font-bold">Settings</h2>
            <p className="text-sm text-muted-foreground">
              Manage your account settings and preferences.
            </p>
          </div>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Profile</CardTitle>
                <CardDescription>Update your personal information.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <FieldGroup className="gap-4">
                <Field>
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input
                    id="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                <div>
                  <Button onClick={handleSaveProfile}>Save Changes</Button>
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
                  <CardDescription>Change your account password.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <FieldGroup className="gap-4">
                <Field>
                  <FieldLabel htmlFor="currentPassword">Current Password</FieldLabel>
                  <Input
                    id="currentPassword"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="newPassword">New Password</FieldLabel>
                  <Input
                    id="newPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                  <FieldDescription>
                    Must be at least 8 characters long.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="confirmPassword">Confirm New Password</FieldLabel>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </Field>
                <div>
                  <Button onClick={handleChangePassword}>Change Password</Button>
                </div>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card className="border-destructive/50">
            <CardContent className="pt-6">
              <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <DialogTrigger render={<Button variant="destructive" />}>
                  Delete Account
                </DialogTrigger>
                <DialogContent className="sm:max-w-[425px]">
                  <DialogHeader>
                    <DialogTitle>Are you absolutely sure?</DialogTitle>
                    <DialogDescription>
                      This action cannot be undone. This will permanently delete your account and remove all your data from our servers.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                      Cancel
                    </Button>
                    <Button variant="destructive" onClick={() => {
                      toast.success("Account deleted")
                      setDeleteOpen(false)
                    }}>
                      Yes, delete my account
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <p className="text-sm text-muted-foreground mt-3">
                This action is irreversible. All your SMTP configs, API keys, and email logs will be permanently deleted.
              </p>
            </CardContent>
          </Card>
        </div>
        </SessionGuard>
      </SidebarInset>
    </SidebarProvider>
  )
}
