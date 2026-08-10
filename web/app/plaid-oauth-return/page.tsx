'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePlaidLink } from 'react-plaid-link'
import { Loader2 } from 'lucide-react'
import { getToken } from '@/lib/auth'

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function PlaidOAuthReturnPage() {
  const router = useRouter()
  const [linkToken, setLinkToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const stored = sessionStorage.getItem('plaid_link_token')
    if (!stored) { setError('Missing bank connection session. Please try connecting again.'); return }
    setLinkToken(stored)
  }, [])

  const { open, ready } = usePlaidLink({
    token: linkToken ?? '',
    receivedRedirectUri: typeof window !== 'undefined' ? window.location.href : undefined,
    onSuccess: async (publicToken) => {
      try {
        const token = getToken()
        await fetch(`${BASE}/api/v1/plaid/exchange-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ public_token: publicToken }),
        })
        sessionStorage.removeItem('plaid_link_token')
        router.replace('/accounts')
      } catch {
        setError('Failed to finish connecting your account.')
      }
    },
    onExit: () => {
      sessionStorage.removeItem('plaid_link_token')
      router.replace('/accounts')
    },
  })

  useEffect(() => {
    if (ready && linkToken) open()
  }, [ready, linkToken, open])

  return (
    <div className="flex flex-col items-center justify-center h-screen gap-4 px-6 text-center">
      {error ? (
        <>
          <p className="text-red-500 dark:text-red-400">{error}</p>
          <button onClick={() => router.replace('/accounts')} className="text-blue-600 dark:text-blue-400 underline text-sm">
            Back to Accounts
          </button>
        </>
      ) : (
        <>
          <Loader2 className="animate-spin text-blue-600" size={32} />
          <p className="text-gray-500 dark:text-gray-400 text-sm">Finishing bank connection…</p>
        </>
      )}
    </div>
  )
}
