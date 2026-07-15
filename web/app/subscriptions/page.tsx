'use client'
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'

import { apiFetch, BASE } from '@/lib/api'

interface Subscription {
  merchant: string
  cadence: string
  expected_days: number
  amount: number
  annual_cost: number
  occurrences: number
  last_seen: string
  next_expected: string
  budget_category_id: string | null
  status: string
  notes: string | null
}

type StatusFilter = 'all' | 'active' | 'paused' | 'cancelled'

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function fmt0(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

function toMonthly(sub: Subscription): number {
  switch (sub.cadence) {
    case 'weekly':     return sub.amount * 52 / 12
    case 'biweekly':   return sub.amount * 26 / 12
    case 'monthly':    return sub.amount
    case 'quarterly':  return sub.amount / 3
    case 'annual':     return sub.amount / 12
    default:           return sub.amount
  }
}

function formatDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function CadenceBadge({ cadence }: { cadence: string }) {
  const styles: Record<string, string> = {
    monthly:   'bg-blue-50 text-blue-700 border-blue-100',
    annual:    'bg-purple-50 text-purple-700 border-purple-100',
    weekly:    'bg-emerald-50 text-emerald-700 border-emerald-100',
    biweekly:  'bg-teal-50 text-teal-700 border-teal-100',
    quarterly: 'bg-orange-50 text-orange-700 border-orange-100',
  }
  const cls = styles[cadence] ?? 'bg-gray-50 text-gray-600 border-gray-200'
  return (
    <span className={cn('inline-block text-xs font-medium px-2 py-0.5 rounded-full border capitalize', cls)}>
      {cadence}
    </span>
  )
}

function StatusToggle({
  status,
  onChange,
  loading,
}: {
  status: string
  onChange: (s: string) => void
  loading: boolean
}) {
  const options = [
    { value: 'active',    label: 'Active',    cls: 'bg-blue-600 text-white' },
    { value: 'paused',    label: 'Paused',    cls: 'bg-amber-400 text-white' },
    { value: 'cancelled', label: 'Cancelled', cls: 'bg-red-500 text-white' },
  ]
  return (
    <div className="flex items-center gap-0.5 rounded-lg overflow-hidden border border-gray-200">
      {options.map(opt => (
        <button
          key={opt.value}
          disabled={loading}
          onClick={() => opt.value !== status && onChange(opt.value)}
          className={cn(
            'text-xs px-2.5 py-1 font-medium transition-colors whitespace-nowrap',
            status === opt.value
              ? opt.cls
              : 'bg-white text-gray-500 hover:bg-gray-50',
            loading && 'opacity-60 cursor-not-allowed'
          )}
        >
          {opt.value === status && loading ? (
            <Loader2 size={10} className="animate-spin inline" />
          ) : (
            opt.label
          )}
        </button>
      ))}
    </div>
  )
}

export default function SubscriptionsPage() {
  const [subs, setSubs] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [updatingMerchant, setUpdatingMerchant] = useState<string | null>(null)

  const fetchSubs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch<any[]>(`/api/v1/subscriptions/`)
      setSubs(data)
    } catch (e) {
      setError('Failed to load subscriptions. Is the API running?')
      setSubs([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSubs() }, [fetchSubs])

  const updateStatus = async (merchant: string, newStatus: string) => {
    setUpdatingMerchant(merchant)
    try {
      await apiFetch(`/api/v1/subscriptions/${encodeURIComponent(merchant)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      })
      setSubs(prev => prev.map(s => s.merchant === merchant ? { ...s, status: newStatus } : s))
    } catch {
      // silently keep old state
    } finally {
      setUpdatingMerchant(null)
    }
  }

  // Derived values
  const activeSubs = subs.filter(s => s.status === 'active')
  const totalMonthly = activeSubs.reduce((sum, s) => sum + toMonthly(s), 0)
  const totalAnnual  = activeSubs.reduce((sum, s) => sum + s.annual_cost, 0)

  const filtered = subs
    .filter(s => filter === 'all' || s.status === filter)
    .sort((a, b) => new Date(a.next_expected).getTime() - new Date(b.next_expected).getTime())

  const FILTER_TABS: { key: StatusFilter; label: string }[] = [
    { key: 'all',       label: `All (${subs.length})` },
    { key: 'active',    label: `Active (${subs.filter(s => s.status === 'active').length})` },
    { key: 'paused',    label: `Paused (${subs.filter(s => s.status === 'paused').length})` },
    { key: 'cancelled', label: `Cancelled (${subs.filter(s => s.status === 'cancelled').length})` },
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-blue-600" size={32} />
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Subscriptions" />
      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-2 text-red-600 text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <p className="text-xs text-gray-500 mb-1">Monthly Cost</p>
          <p className="text-xl font-bold text-blue-600">{fmt(totalMonthly)}</p>
          <p className="text-xs text-gray-400 mt-0.5">active subscriptions</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <p className="text-xs text-gray-500 mb-1">Annual Cost</p>
          <p className="text-xl font-bold text-gray-900">{fmt0(totalAnnual)}</p>
          <p className="text-xs text-gray-400 mt-0.5">per year</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <p className="text-xs text-gray-500 mb-1">Active Subscriptions</p>
          <p className="text-xl font-bold text-blue-600">{activeSubs.length}</p>
          <p className="text-xs text-gray-400 mt-0.5">of {subs.length} total</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl p-1 shadow-sm w-fit">
        {FILTER_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={cn(
              'text-xs px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap',
              filter === tab.key
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Subscription list */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm p-12 text-center">
          <RefreshCw size={40} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-600 font-medium">No subscriptions detected</p>
          <p className="text-sm text-gray-400 mt-1">
            {filter === 'all'
              ? 'Connect a bank account and sync transactions to detect recurring bills.'
              : `No ${filter} subscriptions found.`}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(sub => {
            const isCancelled = sub.status === 'cancelled'
            const isUpdating  = updatingMerchant === sub.merchant
            return (
              <div
                key={sub.merchant}
                className={cn(
                  'bg-white rounded-2xl shadow-sm px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3',
                  isCancelled && 'opacity-60'
                )}
              >
                {/* Left: merchant + cadence */}
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="min-w-0">
                    <p className={cn(
                      'text-sm font-bold text-gray-900 truncate',
                      isCancelled && 'line-through text-gray-400'
                    )}>
                      {sub.merchant}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <CadenceBadge cadence={sub.cadence} />
                      {sub.notes && (
                        <span className="text-xs text-gray-400 truncate max-w-[200px]">{sub.notes}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Middle: due date + occurrences */}
                <div className="flex items-center gap-6 shrink-0 text-xs text-gray-500">
                  <div>
                    <p className="text-gray-400 text-[10px] uppercase tracking-wider mb-0.5">Next Due</p>
                    <p className={cn('font-medium', isCancelled ? 'text-gray-400' : 'text-gray-700')}>
                      {formatDate(sub.next_expected)}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-400 text-[10px] uppercase tracking-wider mb-0.5">Seen</p>
                    <p className="font-medium text-gray-700">{sub.occurrences}x</p>
                  </div>
                </div>

                {/* Right: amount + status */}
                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <p className={cn(
                      'text-base font-bold',
                      isCancelled ? 'text-gray-400 line-through' : 'text-gray-900'
                    )}>
                      {fmt(sub.amount)}
                    </p>
                    <p className="text-xs text-gray-400">{fmt(toMonthly(sub))}/mo</p>
                  </div>
                  <StatusToggle
                    status={sub.status}
                    onChange={s => updateStatus(sub.merchant, s)}
                    loading={isUpdating}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
      </div>
    </div>
  )
}
