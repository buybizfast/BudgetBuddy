'use client'
import { useState, useEffect, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { PiggyBank } from 'lucide-react'
import { setToken } from '@/lib/auth'
import { PasswordInput } from '@/components/PasswordInput'
import { GoogleSignInButton } from '@/components/GoogleSignInButton'

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [inviteRequired, setInviteRequired] = useState(false)
  const [googleClientId, setGoogleClientId] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${BASE}/api/v1/auth/config`)
      .then(r => r.json())
      .then(d => { setInviteRequired(Boolean(d?.invite_required)); setGoogleClientId(d?.google_client_id ?? null) })
      .catch(() => {})
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${BASE}/api/v1/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, invite_code: inviteCode || undefined }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        const detail = err.detail
        setError(typeof detail === 'string' ? detail : Array.isArray(detail) ? detail[0]?.msg || 'Could not create account' : 'Could not create account')
        return
      }
      const { access_token } = await res.json()
      setToken(access_token)
      router.push('/')
    } catch {
      setError(`Could not reach the server at ${BASE}. It may be down, or NEXT_PUBLIC_API_URL may be misconfigured.`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-slate-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mb-3 shadow-lg">
            <PiggyBank size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Budget Buddy</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Create your account</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-6 space-y-4">
          {error && (
            <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm rounded-xl px-4 py-3">
              {error}
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor="email" className="text-sm font-medium text-gray-700 dark:text-gray-300">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="password" className="text-sm font-medium text-gray-700 dark:text-gray-300">Password</label>
            <PasswordInput
              id="password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              required
              minLength={8}
              placeholder="At least 8 characters"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="confirmPassword" className="text-sm font-medium text-gray-700 dark:text-gray-300">Confirm Password</label>
            <PasswordInput
              id="confirmPassword"
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
              required
              minLength={8}
              placeholder="••••••••"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="inviteCode" className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Invite code{' '}
              <span className="text-gray-400 font-normal">
                {inviteRequired ? '(required)' : '(if you were given one)'}
              </span>
            </label>
            <input
              id="inviteCode"
              type="text"
              value={inviteCode}
              onChange={e => setInviteCode(e.target.value)}
              required={inviteRequired}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={inviteRequired ? 'Enter the code you were sent' : 'Optional'}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>

          {googleClientId && (
            <GoogleSignInButton clientId={googleClientId} inviteCode={inviteCode} onError={setError} />
          )}

          <p className="text-center text-sm text-gray-500 dark:text-gray-400">
            Already have an account?{' '}
            <Link href="/login" className="text-blue-600 hover:text-blue-700 font-semibold">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  )
}
