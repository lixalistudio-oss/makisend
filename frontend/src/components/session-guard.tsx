import { useEffect, useState } from "react"
import { LoaderIcon } from "lucide-react"
import { fetchApi } from "@/lib/api"

export function SessionGuard({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchApi("/api/auth/get-session")
      .then((res) => res.json())
      .then((data) => {
        const session = data?.data?.session ?? data?.session
        if (!session) {
          window.location.href = "/login"
        } else {
          setLoading(false)
        }
      })
      .catch(() => {
        window.location.href = "/login"
      })
  }, [])

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <LoaderIcon className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return <>{children}</>
}
