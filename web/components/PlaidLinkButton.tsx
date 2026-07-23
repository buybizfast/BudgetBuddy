'use client'
import { useState, useCallback } from 'react'
import { usePlaidLink } from 'react-plaid-link'
import { Plus, Loader2 } from 'lucide-react'
import { getToken } from '@/lib/auth'

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
        await fetch(`${BASE}/api/v1/plaid/exchange-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ public_token: publicToken }),
        })
        onSuccess()
      } catch { setError('Failed to connect account.') }
    },
    onExit: () => setLinkToken(null),
  })

  const handleClick = useCallback(async () => {
    if (linkToken && ready) { open(); return }
    setFetching(true); setError(null)
    try {
      const token = getToken()
      const res = await fetch(`${BASE}/api/v1/plaid/link-token`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Could not get link token')
      const data = await res.json()
      setLinkToken(data.link_token)
    } catch (e: any) {
      setError(e.message || 'Failed to initialize bank connection')
    } finally { setFetching(false) }
  }, [linkToken, ready, open])

  useCallback(() => { if (ready && linkToken) open() }, [ready, linkToken, open])

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
