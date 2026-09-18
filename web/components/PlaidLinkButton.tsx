'use client'
import { useState, useCallback, useEffect } from 'react'
import { usePlaidLink } from 'react-plaid-link'
import { Plus, Loader2 } from 'lucide-react'
import { getToken } from '@/lib/auth'
import { isNative, openInSystemBrowser, closeSystemBrowser, waitForDeepLink } from '@/lib/native'

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface Props { onSuccess: () => void; className?: string }

export function PlaidLinkButton({ onSuccess, className }: Props) {
  const [linkToken, setLinkToken] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { open, ready } = usePlaidLink({
    token: linkToken ?? '',
    onSuccess: async (publicToken) => {
      try {
        const token = getToken()
        const res = await fetch(`${BASE}/api/v1/plaid/exchange-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ public_token: publicToken }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(typeof err.detail === 'string' ? err.detail : 'Failed to connect account.')
        }
        onSuccess()
      } catch (e: any) { setError(e?.message || 'Failed to connect account.') }
    },
    onExit: (err, metadata) => {
      if (err) console.error('Plaid Link exit error:', err, 'metadata:', metadata)
      setLinkToken(null)
    },
    onEvent: (eventName, metadata) => {
      console.log('Plaid Link event:', eventName, metadata)
    },
  })

  // Native shell: Plaid Hosted Link in the system browser. Bank OAuth pages
  // won't load inside an app webview, and the browser can't hand a
  // public_token back — so the app waits for the deep link, then asks the
  // server to finish the session.
  const connectNative = useCallback(async () => {
    const token = getToken()
    const res = await fetch(`${BASE}/api/v1/plaid/link-token?hosted=true`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error('Could not get link token')
    const { link_token, hosted_link_url } = await res.json()
    if (!hosted_link_url) throw new Error('Hosted Link is not enabled for this Plaid account')

    const returned = waitForDeepLink('plaid-return')
    await openInSystemBrowser(hosted_link_url)
    if (!(await returned)) return // closed the browser without finishing
    await closeSystemBrowser()

    const done = await fetch(`${BASE}/api/v1/plaid/hosted-link/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ link_token }),
    })
    if (!done.ok) {
      const err = await done.json().catch(() => ({}))
      throw new Error(typeof err.detail === 'string' ? err.detail : 'Failed to connect account.')
    }
    onSuccess()
  }, [onSuccess])

  const handleClick = useCallback(async () => {
    if (!isNative() && linkToken && ready) { open(); return }
    setFetching(true); setError(null)
    try {
      if (isNative()) { await connectNative(); return }
      const token = getToken()
      const res = await fetch(`${BASE}/api/v1/plaid/link-token`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Could not get link token')
      const data = await res.json()
      sessionStorage.setItem('plaid_link_token', data.link_token)
      setLinkToken(data.link_token)
    } catch (e: any) {
      setError(e.message || 'Failed to initialize bank connection')
    } finally { setFetching(false) }
  }, [linkToken, ready, open, connectNative])

  useEffect(() => { if (ready && linkToken) open() }, [ready, linkToken, open])

  return (
    <div>
      <button onClick={handleClick} disabled={fetching}
        className={className ?? 'flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-700 hover:bg-blue-600 rounded-lg text-white transition-colors disabled:opacity-50'}>
        {fetching ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
        {fetching ? 'Connecting…' : linkToken && !ready ? 'Loading…' : 'Connect Bank'}
      </button>
      {error && <p className="text-xs text-red-500 dark:text-red-400 mt-1">{error}</p>}
    </div>
  )
}
