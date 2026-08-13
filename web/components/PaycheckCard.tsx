'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Trash2, Loader2, X, Pencil } from 'lucide-react'
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

interface OccurrenceOverride {
  id: string
  paycheck_id: string
  occurrence_date: string
  source: string | null
  amount: number | null
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n)
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

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function PaycheckRow({ source, amount, edited, bordered, onRenameOccurrence, onEditAmount, onReset, onRemove }: {
  source: string; amount: number; edited: boolean; bordered: boolean
  onRenameOccurrence: (newSource: string) => void
  onEditAmount: (newAmount: number) => void
  onReset: () => void
  onRemove: () => void
}) {
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState(source)
  const [editingAmount, setEditingAmount] = useState(false)
  const [amountInput, setAmountInput] = useState(String(amount))

  const saveName = () => {
    setEditingName(false)
    const trimmed = nameInput.trim()
    if (trimmed && trimmed !== source) onRenameOccurrence(trimmed)
    else setNameInput(source)
  }

  const saveAmount = () => {
    setEditingAmount(false)
    const parsed = parseFloat(amountInput)
    if (!isNaN(parsed) && parsed !== amount) onEditAmount(parsed)
    else setAmountInput(String(amount))
  }

  return (
    <div className={cn('flex items-center justify-between px-4 py-2.5 group hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors',
      bordered && 'border-t border-gray-100 dark:border-gray-700')}>
      {editingName ? (
        <input autoFocus value={nameInput}
          onChange={e => setNameInput(e.target.value)}
          onBlur={saveName}
          onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setNameInput(source); setEditingName(false) } }}
          className="text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded border border-blue-400 px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-0 flex-1" />
      ) : (
        <button onClick={() => { setNameInput(source); setEditingName(true) }}
          className="text-sm text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 text-left transition-colors flex items-center gap-1">
          {source}
          {edited && <span title="This occurrence has been edited" className="text-[9px] uppercase tracking-wide text-amber-500">edited</span>}
        </button>
      )}
      <div className="flex items-center gap-2 shrink-0">
        {editingAmount ? (
          <input autoFocus value={amountInput} inputMode="decimal"
            onChange={e => setAmountInput(e.target.value)}
            onBlur={saveAmount}
            onKeyDown={e => { if (e.key === 'Enter') saveAmount(); if (e.key === 'Escape') { setAmountInput(String(amount)); setEditingAmount(false) } }}
            className="w-20 text-sm text-right bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded border border-blue-400 px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        ) : (
          <button onClick={() => { setAmountInput(String(amount)); setEditingAmount(true) }}
            className="text-sm font-medium text-blue-600 hover:underline">
            {fmt(amount)}
          </button>
        )}
        {edited && (
          <button onClick={onReset} title="Revert this occurrence to the schedule default"
            className="opacity-0 group-hover:opacity-100 text-gray-300 dark:text-gray-600 hover:text-amber-500 transition-all">
            <Pencil size={11} />
          </button>
        )}
        <button onClick={onRemove} aria-label={`Remove ${source}`}
          className="opacity-0 group-hover:opacity-100 text-gray-300 dark:text-gray-600 hover:text-red-500 transition-all">
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )
}

interface Props { year: number; month: number; totalIncome?: number; onSyncIncome?: (amount: number) => Promise<void> }

export function PaycheckCard({ year, month, totalIncome, onSyncIncome }: Props) {
  const [paychecks, setPaychecks] = useState<Paycheck[]>([])
  const [overrides, setOverrides] = useState<OccurrenceOverride[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [source, setSource] = useState('')
  const [amount, setAmount] = useState('')
  const [frequency, setFrequency] = useState<Paycheck['frequency']>('biweekly')
  const [nextDate, setNextDate] = useState('')
  const syncedRef = useRef<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, o] = await Promise.all([
        apiFetch<Paycheck[]>('/api/v1/paychecks/'),
        apiFetch<OccurrenceOverride[]>('/api/v1/paychecks/occurrences').catch(() => []),
      ])
      setPaychecks(p)
      setOverrides(o)
    } catch { setPaychecks([]); setOverrides([]) }
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

  const editOccurrence = async (paycheckId: string, occurrenceDate: string, body: { source?: string; amount?: number }) => {
    await apiFetch(`/api/v1/paychecks/${paycheckId}/occurrences/${occurrenceDate}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    await load()
  }

  const resetOccurrence = async (paycheckId: string, occurrenceDate: string) => {
    await apiFetch(`/api/v1/paychecks/${paycheckId}/occurrences/${occurrenceDate}`, { method: 'DELETE' })
    await load()
  }

  const thisMonth = paychecks
    .flatMap(p => paycheckDaysForMonth(p, year, month).map(day => {
      const date = isoDate(year, month, day)
      const override = overrides.find(o => o.paycheck_id === p.id && o.occurrence_date === date)
      return {
        paycheck: p,
        day,
        date,
        source: override?.source ?? p.source,
        amount: override?.amount ?? p.amount,
        edited: !!override,
      }
    }))
    .sort((a, b) => a.day - b.day)
  const thisMonthTotal = thisMonth.reduce((sum, o) => sum + o.amount, 0)

  // Keep the budget month's income in sync with scheduled paychecks automatically.
  useEffect(() => {
    if (loading || !onSyncIncome || totalIncome === undefined || thisMonth.length === 0) return
    if (Math.abs(totalIncome - thisMonthTotal) < 0.005) { syncedRef.current = thisMonthTotal; return }
    if (syncedRef.current === thisMonthTotal) return
    syncedRef.current = thisMonthTotal
    onSyncIncome(thisMonthTotal)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, thisMonthTotal, totalIncome])

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
        <span className="text-sm font-bold text-gray-900 dark:text-gray-100">Income</span>
        <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider">Planned</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-gray-400" /></div>
      ) : thisMonth.length === 0 ? (
        <p className="px-4 py-4 text-xs text-gray-400 dark:text-gray-500">No paychecks scheduled this month.</p>
      ) : (
        thisMonth.map(({ paycheck, day, date, source: occSource, amount: occAmount, edited }, i) => (
          <PaycheckRow key={`${paycheck.id}-${day}`} source={occSource} amount={occAmount} edited={edited} bordered={i > 0}
            onRenameOccurrence={newSource => editOccurrence(paycheck.id, date, { source: newSource })}
            onEditAmount={newAmount => editOccurrence(paycheck.id, date, { amount: newAmount })}
            onReset={() => resetOccurrence(paycheck.id, date)}
            onRemove={() => remove(paycheck.id)} />
        ))
      )}

      {adding ? (
        <div className="px-4 py-3 space-y-2 border-t border-gray-100 dark:border-gray-700">
          <input value={source} onChange={e => setSource(e.target.value)} placeholder="Employer / source"
            className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <div className="flex gap-2">
            <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount" inputMode="decimal"
              className="flex-1 text-sm rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <select value={frequency} onChange={e => setFrequency(e.target.value as Paycheck['frequency'])}
              className="text-sm rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 px-2 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="weekly">Weekly</option>
              <option value="biweekly">Every 2 weeks</option>
              <option value="semimonthly">Twice a month</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <input type="date" value={nextDate} onChange={e => setNextDate(e.target.value)}
            className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <div className="flex gap-2">
            <button onClick={submitAdd} disabled={saving || !source.trim() || !amount || !nextDate}
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
      ) : (
        <button onClick={() => setAdding(true)}
          className="flex items-center gap-1 px-4 py-2.5 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors border-t border-gray-100 dark:border-gray-700 w-full font-medium">
          <Plus size={11} /><span>Add Income</span>
        </button>
      )}
    </div>
  )
}
