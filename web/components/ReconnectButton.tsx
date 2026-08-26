'use client'
import { useState, useCallback, useEffect } from 'react'
import { usePlaidLink } from 'react-plaid-link'
import { RefreshCw, Loader2 } from 'lucide-react'
import { getToken } from '@/lib/auth'

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface Props {
  itemId: string
  onSuccess: () => void
  className?: string
}

/** Re-authorizes an existing bank connection using Plaid Link's update mode.
 *  Unlike disconnect-and-reconnect, the item survives — so its accounts and
 *  transaction history aren't cascade-deleted and re-imported. */
export function ReconnectButton({ itemId, onSuccess, className }: Props) {
  const [linkToken, setLinkToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const finish = useCallback(async () => {
    setBusy(true)
    try {
      const token = getToken()
      const res = await fetch(`${BASE}/api/v1/plaid/items/${itemId}/reauth-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(typeof err.detail === 'string' ? err.detail : 'Reconnect failed')
      }
      onSuccess()
    } catch (e: any) {
      setError(e.message || 'Reconnect failed')
    } finally {
      setBusy(false)
      setLinkToken(null)
    }
  }, [itemId, onSuccess])

  const { open, ready } = usePlaidLink({
    token: linkToken ?? '',
    onSuccess: () => { finish() },
    onExit: (err) => {
      if (err) setError('Reconnect was cancelled before finishing.')
      setLinkToken(null)
    },
  })

  const start = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const token = getToken()
      const res = await fetch(`${BASE}/api/v1/plaid/items/${itemId}/update-token`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(typeof err.detail === 'string' ? err.detail : 'Could not start reconnect')
      }
      const data = await res.json()
      setLinkToken(data.link_token)
    } catch (e: any) {
      setError(e.message || 'Could not start reconnect')
    } finally {
      setBusy(false)
    }
  }, [itemId])

  useEffect(() => { if (ready && linkToken) open() }, [ready, linkToken, open])

  return (
    <div>
      <button onClick={start} disabled={busy}
        className={className ?? 'flex items-center gap-1 text-xs px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50'}>
        {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        {busy ? 'Reconnecting…' : 'Reconnect'}
      </button>
      {error && <p className="text-xs text-red-500 dark:text-red-400 mt-1">{error}</p>}
    </div>
  )
}
