'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { getToken, clearToken } from '@/lib/auth'
import { BottomNav } from '@/components/BottomNav'

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [verified, setVerified] = useState(false)
  const isLogin = pathname === '/login'

  useEffect(() => {
    if (isLogin) { setVerified(true); return }
    const token = getToken()
    if (!token) { router.replace('/login'); return }

    fetch(`${BASE}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => {
        if (r.status === 401) { clearToken(); router.replace('/login') }
        else setVerified(true)
      })
      .catch(() => setVerified(true))
  }, [pathname, router, isLogin])

  if (!verified) return null
  return (
    <>
      {children}
      {!isLogin && <BottomNav />}
    </>
  )
}
