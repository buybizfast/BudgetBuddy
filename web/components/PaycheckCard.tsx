'use client'
import { useState, useEffect, useCallback } from 'react'
import { Wallet, Plus, Trash2, Loader2, X, RefreshCw } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Paycheck {
  id: string
  source: string
  amount: number
  frequency: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly'
  next_date: string
  active: boolean
}

interface UpcomingPaycheck {
  id: string
  source: string
  amount: number
  date: string
  days_until: number
}

const FREQUENCY_LABEL: Record<string, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  semimonthly: 'Twice a month',
  monthly: 'Monthly',
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const PAYCHECK_STEP_DAYS: Record<string, number> = { weekly: 7, biweekly: 14, semimonthly: 15 }

/** Days of the given month a paycheck lands on, mirroring the calendar page's logic. */
function paycheckDaysForMonth(p: Paycheck, year: number, month: number): number[] {
  const daysInMonth = new Date(year, month, 0).getDate()
  const base = new Date(p.next_date + 'T00:00:00')
  if (p.frequency === 'monthly') return [Math.min(base.getDate(), daysInMonth)]
  const step = PAYCHECK_STEP_DAYS[p.frequency] ?? 14
  const displayFirst = new Date(year, month - 1, 1)
  const diffDays = Math.floor((displayFirst.getTime() - base.getTime()) / 86400000)
  const remainder = ((diffDays % step) + step) % step
  const firstOccurrence = remainder === 0 ? 1 : step - remainder + 1
  const days: number[] = []
  for (let d = firstOccurrence; d <= daysInMonth; d += step) days.push(d)
  return days
}

interface Props { year: number; month: number; totalIncome?: number; onSyncIncome?: (amount: number) => Promise<void> }

export function PaycheckCard({ year, month, totalIncome, onSyncIncome }: Props) {
  const [paychecks, setPaychecks] = useState<Paycheck[]>([])
  const [upcoming, setUpcoming] = useState<UpcomingPaycheck[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [source, setSource] = useState('')
  const [amount, setAmount] = useState('')
  const [frequency, setFrequency] = useState<Paycheck['frequency']>('biweekly')
  const [nextDate, setNextDate] = useState('')
  const [syncing, setSyncing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, next] = await Promise.all([
        apiFetch<Paycheck[]>('/api/v1/paychecks/'),
        apiFetch<UpcomingPaycheck[]>('/api/v1/paychecks/upcoming?days_ahead=30'),
      ])
      setPaychecks(list)
      setUpcoming(next)
    } catch { setPaychecks([]); setUpcoming([]) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const submitAdd = async () => {
    if (!source.trim() || !amount || !nextDate) return
    setSaving(true)
    try {
      await apiFetch('/api/v1/paychecks/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: source.trim(), amount: parseFloat(amount), frequency, next_date: nextDate }),
      })
      setSource(''); setAmount(''); setNextDate(''); setFrequency('biweekly'); setAdding(false)
      await load()
    } finally { setSaving(false) }
  }

  const remove = async (id: string) => {
    await apiFetch(`/api/v1/paychecks/${id}`, { method: 'DELETE' })
    await load()
  }

  const nextPaycheck = upcoming[0]

  const thisMonth = paychecks
    .flatMap(p => paycheckDaysForMonth(p, year, month).map(day => ({ paycheck: p, day })))
    .sort((a, b) => a.day - b.day)
  const thisMonthTotal = thisMonth.reduce((sum, { paycheck }) => sum + paycheck.amount, 0)
  const inSync = totalIncome !== undefined && Math.abs(totalIncome - thisMonthTotal) < 0.005

  const syncIncome = async () => {
    if (!onSyncIncome) return
    setSyncing(true)
    try { await onSyncIncome(thisMonthTotal) } finally { setSyncing(false) }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Wallet size={14} className="text-green-600" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Paychecks</h3>
        </div>
        <button onClick={() => setAdding(v => !v)}
          className="flex items-center gap-1 text-xs px-2.5 py-1 bg-green-50 dark:bg-green-950/40 hover:bg-green-100 dark:hover:bg-green-900/40 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800 rounded-lg transition-colors font-medium">
          {adding ? <X size={11} /> : <Plus size={11} />}
          {adding ? 'Cancel' : 'Add Paycheck'}
        </button>
      </div>

      {adding && (
        <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-900 rounded-xl space-y-2">
          <input value={source} onChange={e => setSource(e.target.value)} placeholder="Employer / source"
            className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <div className="flex gap-2">
            <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount" inputMode="decimal"
              className="flex-1 text-sm rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <select value={frequency} onChange={e => setFrequency(e.target.value as Paycheck['frequency'])}
              className="text-sm rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 px-2 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="weekly">Weekly</option>
              <option value="biweekly">Every 2 weeks</option>
              <option value="semimonthly">Twice a month</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <input type="date" value={nextDate} onChange={e => setNextDate(e.target.value)}
            className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button onClick={submitAdd} disabled={saving || !source.trim() || !amount || !nextDate}
            className="w-full text-sm py-2 bg-[#1a2e4a] hover:bg-[#162540] disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            Save Paycheck
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-3"><Loader2 size={16} className="animate-spin text-gray-400" /></div>
      ) : paychecks.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500">No paychecks scheduled yet. Add one to track upcoming income.</p>
      ) : (
        <>
          {nextPaycheck && (
            <div className="flex items-center justify-between mb-3 p-2.5 bg-green-50 dark:bg-green-950/30 rounded-lg">
              <div>
                <p className="text-xs text-green-700 dark:text-green-400 font-medium">Next paycheck</p>
                <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{fmtDate(nextPaycheck.date)} · {fmt(nextPaycheck.amount)}</p>
              </div>
              <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                {nextPaycheck.days_until === 0 ? 'Today' : `in ${nextPaycheck.days_until}d`}
              </span>
            </div>
          )}
          {thisMonth.length > 0 && (
            <div className="mb-3 p-2.5 bg-blue-50 dark:bg-blue-950/30 rounded-lg">
              <div className="flex items-center justify-between">
                <p className="text-xs text-blue-700 dark:text-blue-400 font-medium">
                  This month's paychecks ({thisMonth.length})
                </p>
                <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{fmt(thisMonthTotal)}</p>
              </div>
              {onSyncIncome && (
                <button onClick={syncIncome} disabled={syncing || inSync}
                  className="mt-2 w-full flex items-center justify-center gap-1.5 text-xs py-1.5 bg-white dark:bg-gray-800 hover:bg-blue-100 dark:hover:bg-blue-900/40 disabled:opacity-50 disabled:hover:bg-white dark:disabled:hover:bg-gray-800 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-lg transition-colors font-medium">
                  {syncing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                  {inSync ? 'Income matches paychecks' : `Set month's income to ${fmt(thisMonthTotal)}`}
                </button>
              )}
            </div>
          )}
          <div className="space-y-2">
            {paychecks.map(p => (
              <div key={p.id} className="flex items-center justify-between group">
                <div className="min-w-0">
                  <p className="text-xs text-gray-700 dark:text-gray-300 truncate font-medium">{p.source}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">{FREQUENCY_LABEL[p.frequency]}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">{fmt(p.amount)}</span>
                  <button onClick={() => remove(p.id)} aria-label={`Remove ${p.source}`}
                    className="opacity-0 group-hover:opacity-100 text-gray-300 dark:text-gray-600 hover:text-red-500 transition-all">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
