'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Loader2, X, Pencil, ChevronDown, ChevronRight } from 'lucide-react'
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
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
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

function PaycheckRow({ source, amount, date, frequency, edited, onRenameOccurrence, onEditAmount, onReset, onRemove }: {
  source: string; amount: number; date: string; frequency: string; edited: boolean
  onRenameOccurrence: (newSource: string) => void
  onEditAmount: (newAmount: number) => void
  onReset: () => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const [nameInput, setNameInput] = useState(source)
  const [amountInput, setAmountInput] = useState(String(amount))

  const FREQ_LABEL: Record<string, string> = {
    weekly: 'every week', biweekly: 'every 2 weeks', semimonthly: 'twice a month', monthly: 'every month',
  }

  const openEditor = () => {
    setNameInput(source)
    setAmountInput(String(amount))
    setOpen(true)
  }

  const save = () => {
    const trimmed = nameInput.trim()
    if (trimmed && trimmed !== source) onRenameOccurrence(trimmed)
    const parsed = parseFloat(amountInput.replace(/[^0-9.]/g, ''))
    if (!isNaN(parsed) && parsed !== amount) onEditAmount(parsed)
    setOpen(false)
  }

  const prettyDate = new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  return (
    <div className="border-t border-gray-100 dark:border-gray-700 group">
      {/* Whole row opens the editor — same pattern as budget category rows. */}
      <div
        role="button"
        tabIndex={0}
        aria-label={`Edit ${source}`}
        onClick={openEditor}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditor() } }}
        className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
      >
        <div className="flex-1 min-w-0 flex items-center gap-1.5 pl-4">
          <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{source}</span>
          {edited && (
            <span title="This occurrence was edited away from the schedule default"
              className="shrink-0 text-amber-500"><Pencil size={11} /></span>
          )}
        </div>
        <div className="flex items-center shrink-0">
          <span className="text-xs text-blue-600 w-20 text-right font-medium">{fmt(amount)}</span>
          <span className="text-xs w-20 text-right text-gray-400 dark:text-gray-500">—</span>
          <span className="text-xs w-20 text-right font-semibold text-gray-400 dark:text-gray-500">—</span>
          <ChevronRight size={13} className="ml-2 text-gray-300 dark:text-gray-600 shrink-0" aria-hidden="true" />
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setOpen(false)}>
          <div onClick={e => e.stopPropagation()}
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Edit Paycheck</h3>
              <button onClick={() => setOpen(false)} aria-label="Close"
                className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-gray-400 dark:text-gray-500">
              Arrives {prettyDate} · repeats {FREQ_LABEL[frequency] ?? frequency}. Changes here apply to this
              occurrence only — the schedule keeps its defaults.
            </p>

            <div>
              <label htmlFor="pc-source" className="text-xs text-gray-500 dark:text-gray-400 mb-1 block font-medium">Source</label>
              <input id="pc-source" value={nameInput} onChange={e => setNameInput(e.target.value)}
                className="w-full bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm rounded-xl px-3 py-2 border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            <div>
              <label htmlFor="pc-amount" className="text-xs text-gray-500 dark:text-gray-400 mb-1 block font-medium">Amount</label>
              <div className="flex items-center gap-1">
                <span className="text-gray-400 dark:text-gray-500 text-sm">$</span>
                <input id="pc-amount" value={amountInput} inputMode="decimal" onChange={e => setAmountInput(e.target.value)}
                  className="flex-1 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm rounded-xl px-3 py-2 border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

            {edited && (
              <button onClick={() => { onReset(); setOpen(false) }}
                className="w-full text-xs font-medium text-amber-600 hover:text-amber-700 bg-amber-50 dark:bg-amber-950/30 rounded-xl py-2 transition-colors">
                Reset this occurrence to the schedule default
              </button>
            )}

            <div className="flex gap-2 pt-1">
              <button onClick={save}
                className="flex-1 text-sm py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-colors">
                Save
              </button>
              <button onClick={() => setOpen(false)}
                className="text-sm px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-xl transition-colors">
                Cancel
              </button>
            </div>

            <button
              onClick={() => { if (confirm(`Remove the "${source}" paycheck schedule? All its future occurrences go with it.`)) { onRemove(); setOpen(false) } }}
              className="w-full text-xs text-red-500 hover:text-red-600 transition-colors pt-1">
              Delete this paycheck schedule
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

interface Props { year: number; month: number; totalIncome?: number; onSyncIncome?: (amount: number) => Promise<void> }

export function PaycheckCard({ year, month, totalIncome, onSyncIncome }: Props) {
  const [paychecks, setPaychecks] = useState<Paycheck[]>([])
  const [overrides, setOverrides] = useState<OccurrenceOverride[]>([])
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState(false)
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
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        aria-controls="income-group"
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setCollapsed(v => !v)}
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors border-b border-gray-100 dark:border-gray-700"
        onClick={() => setCollapsed(v => !v)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <ChevronDown size={14} aria-hidden="true" className={cn('text-gray-400 dark:text-gray-500 shrink-0 transition-transform', collapsed && '-rotate-90')} />
          <span className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">Income</span>
        </div>
        <div className="flex items-center gap-5 shrink-0 text-xs">
          <div className="text-right">
            <p className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-wider">Planned</p>
            <p className="font-semibold text-gray-700 dark:text-gray-300">{fmt(thisMonthTotal)}</p>
          </div>
          <div className="text-right">
            <p className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-wider">Spent</p>
            <p className="font-semibold text-gray-400 dark:text-gray-500">—</p>
          </div>
          <div className="text-right">
            <p className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-wider">Remaining</p>
            <p className="font-semibold text-blue-600">{fmt(thisMonthTotal)}</p>
          </div>
        </div>
      </div>

      {!collapsed && (
        <div id="income-group">
          <div className="flex items-center px-4 py-1.5 bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-700">
            <span className="flex-1 text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider pl-4">Category</span>
            <div className="flex items-center gap-0 shrink-0">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider w-20 text-right">Planned</span>
              <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider w-20 text-right">Spent</span>
              <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider w-20 text-right">Remaining</span>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-gray-400" /></div>
          ) : thisMonth.length === 0 ? (
            <p className="px-4 py-4 text-xs text-gray-400 dark:text-gray-500">No paychecks scheduled this month.</p>
          ) : (
            thisMonth.map(({ paycheck, day, date, source: occSource, amount: occAmount, edited }) => (
              <PaycheckRow key={`${paycheck.id}-${day}`} source={occSource} amount={occAmount} date={date}
                frequency={paycheck.frequency} edited={edited}
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
      )}
    </div>
  )
}
