'use client'
import { useState, FormEvent, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { PiggyBank, CheckCircle2 } from 'lucide-react'
import { PasswordInput } from '@/components/PasswordInput'

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

function ResetPasswordForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') || ''
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (!token) {
      setError('This reset link is invalid or has expired.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${BASE}/api/v1/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.detail || 'This reset link is invalid or has expired.')
        return
      }
      setDone(true)
    } catch {
      setError('Could not connect to server')
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
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Choose a new password</p>
        </div>

        {done ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-6 space-y-4 text-center">
            <CheckCircle2 size={40} className="text-emerald-500 mx-auto" />
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Your password has been reset.
            </p>
            <Link href="/login" className="inline-block text-sm text-blue-600 hover:text-blue-700 font-semibold">
              Sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-6 space-y-4">
            {error && (
              <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm rounded-xl px-4 py-3">
                {error}
              </div>
            )}
            <div className="space-y-1">
              <label htmlFor="password" className="text-sm font-medium text-gray-700 dark:text-gray-300">New password</label>
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
              <label htmlFor="confirmPassword" className="text-sm font-medium text-gray-700 dark:text-gray-300">Confirm new password</label>
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
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
            >
              {loading ? 'Resetting…' : 'Reset password'}
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

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  )
}
