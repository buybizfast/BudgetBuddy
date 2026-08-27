'use client'
import { useState, FormEvent } from 'react'
import Link from 'next/link'
import { PiggyBank, CheckCircle2 } from 'lucide-react'

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${BASE}/api/v1/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        setError('Something went wrong — please try again.')
        return
      }
      setSent(true)
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
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Reset your password</p>
        </div>

        {sent ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-6 space-y-4 text-center">
            <CheckCircle2 size={40} className="text-emerald-500 mx-auto" />
            <p className="text-sm text-gray-700 dark:text-gray-300">
              If an account exists for <span className="font-semibold">{email}</span>, a password reset link is on its way.
              It expires in 30 minutes.
            </p>
            <Link href="/login" className="inline-block text-sm text-blue-600 hover:text-blue-700 font-semibold">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-6 space-y-4">
            {error && (
              <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm rounded-xl px-4 py-3">
                {error}
              </div>
            )}
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Enter the email you signed up with, and we'll send you a link to reset your password.
            </p>
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
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
            >
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
            <p className="text-center text-sm text-gray-500 dark:text-gray-400">
              <Link href="/login" className="text-blue-600 hover:text-blue-700 font-semibold">Back to sign in</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
