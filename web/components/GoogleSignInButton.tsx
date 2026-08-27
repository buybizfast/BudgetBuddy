'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { setToken } from '@/lib/auth'

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const GSI_SRC = 'https://accounts.google.com/gsi/client'

declare global {
  interface Window { google?: any }
}

interface Props {
  clientId: string
  /** Passed through when Google sign-in creates a new account on a gated
   *  deployment; ignored for existing accounts. */
  inviteCode?: string
  onError: (message: string) => void
}

function loadGsi(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) { resolve(); return }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Could not load Google sign-in')))
      return
    }
    const script = document.createElement('script')
    script.src = GSI_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Could not load Google sign-in'))
    document.head.appendChild(script)
  })
}

export function GoogleSignInButton({ clientId, inviteCode, onError }: Props) {
  const router = useRouter()
  const holder = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  // Keep the latest invite code visible to Google's callback, which is
  // registered once and would otherwise capture a stale value.
  const inviteRef = useRef(inviteCode)
  useEffect(() => { inviteRef.current = inviteCode }, [inviteCode])

  useEffect(() => {
    let cancelled = false

    async function handleCredential(response: { credential: string }) {
      setBusy(true)
      try {
        const res = await fetch(`${BASE}/api/v1/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            credential: response.credential,
            invite_code: inviteRef.current || undefined,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(typeof err.detail === 'string' ? err.detail : 'Google sign-in failed')
        }
        const { access_token } = await res.json()
        setToken(access_token)
        router.push('/')
      } catch (e: any) {
        onError(e?.message || 'Google sign-in failed')
      } finally {
        setBusy(false)
      }
    }

    loadGsi()
      .then(() => {
        if (cancelled || !holder.current) return
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: handleCredential,
        })
        window.google.accounts.id.renderButton(holder.current, {
          theme: 'outline',
          size: 'large',
          width: 320,
          text: 'continue_with',
        })
      })
      .catch(e => onError(e.message))

    return () => { cancelled = true }
    // clientId is the only input that should rebuild the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
        <span className="text-xs text-gray-400 dark:text-gray-500">or</span>
        <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
      </div>
      <div className="flex justify-center">
        <div ref={holder} className={busy ? 'opacity-50 pointer-events-none' : ''} />
      </div>
    </div>
  )
}
