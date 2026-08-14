'use client'
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Loader2, AlertCircle, Plus, Trash2, X, RotateCcw, ChevronDown } from 'lucide-react'
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
  last_seen: string | null
  next_expected: string
  budget_category_id: string | null
  status: string
  notes: string | null
  is_manual: boolean
}

const CADENCES = ['weekly', 'biweekly', 'monthly', 'quarterly', 'annual']

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

const CADENCE_STYLES: Record<string, string> = {
  monthly:   'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-100 dark:border-blue-900',
  annual:    'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-100 dark:border-purple-900',
  weekly:    'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-900',
  biweekly:  'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border-teal-100 dark:border-teal-900',
  quarterly: 'bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border-orange-100 dark:border-orange-900',
}

function CadenceBadge({ cadence }: { cadence: string }) {
  const cls = CADENCE_STYLES[cadence] ?? 'bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700'
  return (
    <span className={cn('inline-block text-xs font-medium px-2 py-0.5 rounded-full border capitalize', cls)}>
      {cadence}
    </span>
  )
}

function CadenceSelect({ cadence, onChange, loading }: { cadence: string; onChange: (c: string) => void; loading: boolean }) {
  const cls = CADENCE_STYLES[cadence] ?? 'bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700'
  return (
    <select
      value={cadence}
      disabled={loading}
      onChange={e => onChange(e.target.value)}
      title="How often this subscription bills"
      className={cn(
        'text-xs font-medium rounded-full border capitalize pl-2 pr-5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500 appearance-none bg-no-repeat disabled:opacity-60',
        cls
      )}
      style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath fill='none' stroke='currentColor' stroke-width='1.5' d='M2.5 4.5L6 8l3.5-3.5'/%3E%3C/svg%3E")`, backgroundPosition: 'right 4px center', backgroundSize: '9px' }}
    >
      {CADENCES.map(c => <option key={c} value={c}>{c}</option>)}
    </select>
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
    <div className="flex items-center gap-0.5 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
      {options.map(opt => (
        <button
          key={opt.value}
          disabled={loading}
          onClick={() => opt.value !== status && onChange(opt.value)}
          className={cn(
            'text-xs px-2.5 py-1 font-medium transition-colors whitespace-nowrap',
            status === opt.value
              ? opt.cls
              : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700',
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
  const [removingMerchant, setRemovingMerchant] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newMerchant, setNewMerchant] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [newCadence, setNewCadence] = useState('monthly')
  const [newNextExpected, setNewNextExpected] = useState('')
  const [deletedSubs, setDeletedSubs] = useState<Subscription[]>([])
  const [showDeleted, setShowDeleted] = useState(false)
  const [loadingDeleted, setLoadingDeleted] = useState(false)
  const [restoringMerchant, setRestoringMerchant] = useState<string | null>(null)

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

  const fetchDeleted = useCallback(async () => {
    setLoadingDeleted(true)
    try {
      setDeletedSubs(await apiFetch<Subscription[]>('/api/v1/subscriptions/deleted'))
    } catch {
      setDeletedSubs([])
    } finally {
      setLoadingDeleted(false)
    }
  }, [])

  const toggleDeleted = () => {
    setShowDeleted(v => {
      const next = !v
      if (next) fetchDeleted()
      return next
    })
  }

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

  const updateCadence = async (merchant: string, newCadence: string) => {
    setUpdatingMerchant(merchant)
    try {
      await apiFetch(`/api/v1/subscriptions/${encodeURIComponent(merchant)}`, {
        method: 'PATCH',
        body: JSON.stringify({ cadence: newCadence }),
      })
      await fetchSubs()
    } finally {
      setUpdatingMerchant(null)
    }
  }

  const submitAdd = async () => {
    if (!newMerchant.trim() || !newAmount) return
    setSaving(true)
    try {
      await apiFetch('/api/v1/subscriptions/', {
        method: 'POST',
        body: JSON.stringify({
          merchant: newMerchant.trim(),
          amount: parseFloat(newAmount),
          cadence: newCadence,
          next_expected: newNextExpected || undefined,
        }),
      })
      setNewMerchant(''); setNewAmount(''); setNewCadence('monthly'); setNewNextExpected(''); setAdding(false)
      await fetchSubs()
    } finally {
      setSaving(false)
    }
  }

  const removeSubscription = async (merchant: string) => {
    setRemovingMerchant(merchant)
    try {
      await apiFetch(`/api/v1/subscriptions/${encodeURIComponent(merchant)}`, { method: 'DELETE' })
      setSubs(prev => prev.filter(s => s.merchant !== merchant))
      if (showDeleted) await fetchDeleted()
    } finally {
      setRemovingMerchant(null)
    }
  }

  const restoreSubscription = async (merchant: string) => {
    setRestoringMerchant(merchant)
    try {
      await apiFetch(`/api/v1/subscriptions/${encodeURIComponent(merchant)}/restore`, { method: 'POST' })
      setDeletedSubs(prev => prev.filter(s => s.merchant !== merchant))
      await fetchSubs()
    } finally {
      setRestoringMerchant(null)
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
        <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl p-3 flex items-center gap-2 text-red-600 dark:text-red-300 text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Monthly Cost</p>
          <p className="text-xl font-bold text-blue-600">{fmt(totalMonthly)}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">active subscriptions</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Annual Cost</p>
          <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{fmt0(totalAnnual)}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">per year</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Active Subscriptions</p>
          <p className="text-xl font-bold text-blue-600">{activeSubs.length}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">of {subs.length} total</p>
        </div>
      </div>

      {/* Filter tabs + add */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-1 shadow-sm w-fit">
          {FILTER_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={cn(
                'text-xs px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap',
                filter === tab.key
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleDeleted}
            className={cn(
              'flex items-center gap-1 text-xs px-3 py-2 rounded-xl font-medium transition-colors border',
              showDeleted
                ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-600'
                : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
            )}>
            <RotateCcw size={12} />Recently Deleted
            {deletedSubs.length > 0 && <span className="text-[10px] bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded-full">{deletedSubs.length}</span>}
            <ChevronDown size={12} className={cn('transition-transform', showDeleted && 'rotate-180')} />
          </button>
          <button onClick={() => setAdding(v => !v)}
            className="flex items-center gap-1 text-xs px-3 py-2 bg-[#1a2e4a] hover:bg-[#162540] text-white rounded-xl font-medium transition-colors">
            <Plus size={12} />Add Subscription
          </button>
        </div>
      </div>

      {/* Recently deleted */}
      {showDeleted && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">Recently Deleted</p>
          {loadingDeleted ? (
            <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-gray-400" /></div>
          ) : deletedSubs.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500">Nothing deleted recently.</p>
          ) : (
            <div className="space-y-2">
              {deletedSubs.map(sub => (
                <div key={sub.merchant} className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-900">
                  <div className="min-w-0 flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">{sub.merchant}</p>
                    <CadenceBadge cadence={sub.cadence} />
                    <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">{fmt(sub.amount)}</span>
                  </div>
                  <button
                    onClick={() => restoreSubscription(sub.merchant)}
                    disabled={restoringMerchant === sub.merchant}
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-blue-400 hover:text-blue-600 text-gray-600 dark:text-gray-300 rounded-lg font-medium transition-colors disabled:opacity-50 shrink-0">
                    {restoringMerchant === sub.merchant ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {adding && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4 space-y-2">
          <input value={newMerchant} onChange={e => setNewMerchant(e.target.value)} placeholder="Subscription name (e.g. Netflix)"
            className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <div className="flex gap-2">
            <input value={newAmount} onChange={e => setNewAmount(e.target.value)} placeholder="Amount" inputMode="decimal"
              className="flex-1 text-sm rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <select value={newCadence} onChange={e => setNewCadence(e.target.value)}
              className="text-sm rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 px-2 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 capitalize">
              {CADENCES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <input type="date" value={newNextExpected} onChange={e => setNewNextExpected(e.target.value)}
            className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <div className="flex gap-2">
            <button onClick={submitAdd} disabled={saving || !newMerchant.trim() || !newAmount}
              className="flex-1 text-sm py-2 bg-[#1a2e4a] hover:bg-[#162540] disabled:opacity-50 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2">
              {saving && <Loader2 size={14} className="animate-spin" />}
              Save
            </button>
            <button onClick={() => setAdding(false)}
              className="text-sm px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-xl transition-colors flex items-center gap-1">
              <X size={12} />Cancel
            </button>
          </div>
        </div>
      )}

      {/* Subscription list */}
      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-12 text-center">
          <RefreshCw size={40} className="text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-600 dark:text-gray-300 font-medium">No subscriptions detected</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
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
                  'bg-white dark:bg-gray-800 rounded-2xl shadow-sm px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3',
                  isCancelled && 'opacity-60'
                )}
              >
                {/* Left: merchant + cadence */}
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="min-w-0">
                    <p className={cn(
                      'text-sm font-bold text-gray-900 dark:text-gray-100 truncate',
                      isCancelled && 'line-through text-gray-400 dark:text-gray-500'
                    )}>
                      {sub.merchant}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <CadenceSelect cadence={sub.cadence} loading={updatingMerchant === sub.merchant} onChange={c => updateCadence(sub.merchant, c)} />
                      {sub.is_manual && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">manual</span>
                      )}
                      {sub.notes && (
                        <span className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-[200px]">{sub.notes}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Middle: due date + occurrences */}
                <div className="flex items-center gap-6 shrink-0 text-xs text-gray-500 dark:text-gray-400">
                  <div>
                    <p className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-wider mb-0.5">Next Due</p>
                    <p className={cn('font-medium', isCancelled ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300')}>
                      {formatDate(sub.next_expected)}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-wider mb-0.5">Seen</p>
                    <p className="font-medium text-gray-700 dark:text-gray-300">{sub.occurrences}x</p>
                  </div>
                </div>

                {/* Right: amount + status */}
                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <p className={cn(
                      'text-base font-bold',
                      isCancelled ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-900 dark:text-gray-100'
                    )}>
                      {fmt(sub.amount)}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">{fmt(toMonthly(sub))}/mo</p>
                  </div>
                  <StatusToggle
                    status={sub.status}
                    onChange={s => updateStatus(sub.merchant, s)}
                    loading={isUpdating}
                  />
                  <button
                    onClick={() => removeSubscription(sub.merchant)}
                    disabled={removingMerchant === sub.merchant}
                    aria-label={`Remove ${sub.merchant}`}
                    title={sub.is_manual ? 'Delete subscription' : 'Hide from this list'}
                    className="text-gray-300 dark:text-gray-600 hover:text-red-500 transition-colors disabled:opacity-50"
                  >
                    {removingMerchant === sub.merchant ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  </button>
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
