'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { getToken, clearToken } from '@/lib/auth'
import { BottomNav } from '@/components/BottomNav'

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const isLogin = pathname === '/login'
  const hasToken = Boolean(getToken())

  // Optimistically show content if token exists; validate in background
  const [ready, setReady] = useState(isLogin || hasToken)

  useEffect(() => {
    if (isLogin) return
    const token = getToken()
    if (!token) { router.replace('/login'); return }

    // Background validation — only kick out on explicit 401
    fetch(`${BASE}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (r.status === 401) { clearToken(); router.replace('/login') } })
      .catch(() => {}) // network error — keep showing the app
  }, [pathname, router, isLogin])

  useEffect(() => {
    if (!isLogin && !hasToken) setReady(false)
  }, [isLogin, hasToken])

  if (!ready) return null
  return (
    <>
      {children}
      {!isLogin && <BottomNav />}
    </>
  )
}
