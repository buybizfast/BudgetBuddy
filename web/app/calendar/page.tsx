'use client'
import { useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight, Loader2, AlertCircle, CheckCircle2, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'

import { apiFetch } from '@/lib/api'

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

interface PaidRecord {
  merchant_name: string
  paid: boolean
  paid_on: string | null
  notes: string | null
}

interface PaycheckSchedule {
  id: string
  source: string
  amount: number
  frequency: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly'
  next_date: string
  active: boolean
}

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function fmt0(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n)
}

const CADENCE_CHIP: Record<string, string> = {
  monthly:   'bg-blue-100 text-blue-800',
  annual:    'bg-purple-100 text-purple-800',
  weekly:    'bg-emerald-100 text-emerald-800',
  biweekly:  'bg-teal-100 text-teal-800',
  quarterly: 'bg-orange-100 text-orange-800',
}

function chipStyle(cadence: string) {
  return CADENCE_CHIP[cadence] ?? 'bg-gray-100 text-gray-700'
}

function billDaysForMonth(sub: Subscription, year: number, month: number): number[] {
  const daysInMonth = new Date(year, month, 0).getDate()
  const base = new Date(sub.next_expected + 'T00:00:00')

  if (sub.cadence === 'weekly') {
    const baseDom = base.getDate()
    const baseMonth = base.getMonth() + 1
    const baseYear = base.getFullYear()
    const displayFirst = new Date(year, month - 1, 1)
    const baseDate = new Date(baseYear, baseMonth - 1, baseDom)
    const diffMs = displayFirst.getTime() - baseDate.getTime()
    const diffDays = Math.floor(diffMs / 86400000)
    const remainder = ((diffDays % 7) + 7) % 7
    const firstOccurrence = remainder === 0 ? 1 : 7 - remainder + 1
    const days: number[] = []
    for (let d = firstOccurrence; d <= daysInMonth; d += 7) days.push(d)
    return days
  }

  if (sub.cadence === 'biweekly') {
    const baseDom = base.getDate()
    const baseMonth = base.getMonth() + 1
    const baseYear = base.getFullYear()
    const displayFirst = new Date(year, month - 1, 1)
    const baseDate = new Date(baseYear, baseMonth - 1, baseDom)
    const diffMs = displayFirst.getTime() - baseDate.getTime()
    const diffDays = Math.floor(diffMs / 86400000)
    const remainder = ((diffDays % 14) + 14) % 14
    const firstOccurrence = remainder === 0 ? 1 : 14 - remainder + 1
    const days: number[] = []
    for (let d = firstOccurrence; d <= daysInMonth; d += 14) days.push(d)
    return days
  }

  const dom = base.getDate()
  return [Math.min(dom, daysInMonth)]
}

const PAYCHECK_STEP_DAYS: Record<string, number> = { weekly: 7, biweekly: 14, semimonthly: 15 }

function paycheckDaysForMonth(p: PaycheckSchedule, year: number, month: number): number[] {
  const daysInMonth = new Date(year, month, 0).getDate()
  const base = new Date(p.next_date + 'T00:00:00')

  if (p.frequency === 'monthly') {
    return [Math.min(base.getDate(), daysInMonth)]
  }

  const step = PAYCHECK_STEP_DAYS[p.frequency] ?? 14
  const displayFirst = new Date(year, month - 1, 1)
  const diffDays = Math.floor((displayFirst.getTime() - base.getTime()) / 86400000)
  const remainder = ((diffDays % step) + step) % step
  const firstOccurrence = remainder === 0 ? 1 : step - remainder + 1
  const days: number[] = []
  for (let d = firstOccurrence; d <= daysInMonth; d += step) days.push(d)
  return days
}

interface ForecastEvent { type: 'paycheck' | 'bill'; name: string; amount: number }
interface ForecastDay { date: string; in: number; out: number; balance: number; events: ForecastEvent[] }
interface Forecast {
  starting_cash: number
  ending_balance: number
  min_balance: number
  min_date: string
  first_negative_date: string | null
  days: ForecastDay[]
}

function CashFlowForecast() {
  const [forecast, setForecast] = useState<Forecast | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    apiFetch<Forecast>('/api/v1/cashflow/forecast').then(setForecast).catch(() => {})
  }, [])

  if (!forecast) return null
  const eventDays = forecast.days.filter(d => d.events.length > 0)
  const shown = expanded ? eventDays : eventDays.slice(0, 5)
  const fmtDay = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">30-Day Cash Flow</h2>
          <span className="text-xs text-gray-400 dark:text-gray-500">{fmt0(forecast.starting_cash)} today</span>
        </div>
        {forecast.first_negative_date ? (
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2 text-xs text-red-700 dark:text-red-300 font-medium">
            ⚠ Your balance is projected to go negative on {fmtDay(forecast.first_negative_date)} (low point {fmt(forecast.min_balance)}).
            Move a bill or add funds before then.
          </div>
        ) : (
          <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300 font-medium">
            ✓ You stay positive all month — lowest point {fmt(forecast.min_balance)} on {fmtDay(forecast.min_date)}.
          </div>
        )}
      </div>
      {eventDays.length > 0 && (
        <div className="divide-y divide-gray-50 dark:divide-gray-700 border-t border-gray-100 dark:border-gray-700">
          {shown.map(d => (
            <div key={d.date} className="px-4 py-2.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">{fmtDay(d.date)}</p>
                <p className={cn('text-xs font-bold', d.balance < 0 ? 'text-red-500' : d.balance < 100 ? 'text-amber-500' : 'text-gray-700 dark:text-gray-300')}>
                  {fmt(d.balance)}
                </p>
              </div>
              <div className="mt-1 space-y-0.5">
                {d.events.map((e, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-gray-600 dark:text-gray-400 truncate">{e.type === 'paycheck' ? '💰' : '📄'} {e.name}</span>
                    <span className={cn('font-medium shrink-0 ml-2', e.type === 'paycheck' ? 'text-green-600 dark:text-green-400' : 'text-red-500')}>
                      {e.type === 'paycheck' ? '+' : '−'}{fmt(e.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {eventDays.length > 5 && (
            <button onClick={() => setExpanded(v => !v)}
              className="w-full py-2 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors">
              {expanded ? 'Show less' : `Show all ${eventDays.length} days`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

interface BillEntry {
  sub: Subscription
  day: number
}

interface PaycheckEntry {
  paycheck: PaycheckSchedule
  day: number
}

export default function CalendarPage() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [subs, setSubs] = useState<Subscription[]>([])
  const [paychecks, setPaychecks] = useState<PaycheckSchedule[]>([])
  const [paidMap, setPaidMap] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [subsData, paidData, paychecksData] = await Promise.all([
        apiFetch<Subscription[]>(`/api/v1/subscriptions/`),
        apiFetch<PaidRecord[]>(`/api/v1/bills/paid?year=${year}&month=${month}`),
        apiFetch<PaycheckSchedule[]>(`/api/v1/paychecks/`).catch(() => []),
      ])
      setSubs(subsData)
      setPaychecks(paychecksData.filter(p => p.active))
      const map: Record<string, boolean> = {}
      for (const p of paidData) {
        if (p.paid) map[p.merchant_name] = true
      }
      setPaidMap(map)
    } catch {
      setError('Failed to load data. Is the API running?')
      setSubs([])
    } finally {
      setLoading(false)
    }
  }, [year, month])

  useEffect(() => { fetchData() }, [fetchData])

  const navMonth = (dir: number) => {
    let m = month + dir, y = year
    if (m < 1) { m = 12; y-- }
    if (m > 12) { m = 1; y++ }
    setMonth(m)
    setYear(y)
  }

  const togglePaid = async (merchant: string) => {
    setToggling(merchant)
    const isPaid = paidMap[merchant]
    // Optimistically update UI first
    if (isPaid) {
      setPaidMap(m => { const n = { ...m }; delete n[merchant]; return n })
    } else {
      setPaidMap(m => ({ ...m, [merchant]: true }))
    }
    try {
      if (isPaid) {
        await apiFetch(`/api/v1/bills/paid?merchant_name=${encodeURIComponent(merchant)}&year=${year}&month=${month}`, { method: 'DELETE' })
      } else {
        await apiFetch('/api/v1/bills/paid', {
          method: 'POST',
          body: JSON.stringify({ merchant_name: merchant, year, month }),
        })
      }
    } catch {
      // Revert on error
      if (isPaid) {
        setPaidMap(m => ({ ...m, [merchant]: true }))
      } else {
        setPaidMap(m => { const n = { ...m }; delete n[merchant]; return n })
      }
    } finally {
      setToggling(null)
    }
  }

  const visibleSubs = subs.filter(s => s.status === 'active' || s.status === 'paused')

  const billsByDay: Record<number, BillEntry[]> = {}
  for (const sub of visibleSubs) {
    const days = billDaysForMonth(sub, year, month)
    for (const d of days) {
      if (!billsByDay[d]) billsByDay[d] = []
      billsByDay[d].push({ sub, day: d })
    }
  }

  const allBillsThisMonth: BillEntry[] = Object.entries(billsByDay)
    .flatMap(([d, entries]) => entries.map(e => ({ ...e, day: Number(d) })))
    .sort((a, b) => a.day - b.day)

  const totalThisMonth = allBillsThisMonth.reduce((sum, { sub }) => sum + sub.amount, 0)
  const paidCount = allBillsThisMonth.filter(({ sub }) => paidMap[sub.merchant]).length
  const paidTotal = allBillsThisMonth.filter(({ sub }) => paidMap[sub.merchant]).reduce((s, { sub }) => s + sub.amount, 0)

  const paychecksByDay: Record<number, PaycheckEntry[]> = {}
  for (const p of paychecks) {
    const days = paycheckDaysForMonth(p, year, month)
    for (const d of days) {
      if (!paychecksByDay[d]) paychecksByDay[d] = []
      paychecksByDay[d].push({ paycheck: p, day: d })
    }
  }
  const allPaychecksThisMonth: PaycheckEntry[] = Object.entries(paychecksByDay)
    .flatMap(([d, entries]) => entries.map(e => ({ ...e, day: Number(d) })))
    .sort((a, b) => a.day - b.day)
  const totalIncomeThisMonth = allPaychecksThisMonth.reduce((sum, { paycheck }) => sum + paycheck.amount, 0)

  const daysInMonth = new Date(year, month, 0).getDate()
  const firstDow = new Date(year, month - 1, 1).getDay()

  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const isToday = (d: number | null) =>
    d !== null && d === today.getDate() && month === today.getMonth() + 1 && year === today.getFullYear()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-blue-600" size={32} />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Bill Calendar"
        left={
          <div className="flex items-center gap-1">
            <button onClick={() => navMonth(-1)} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-colors" aria-label="Previous month">
              <ChevronLeft size={16} />
            </button>
            <button onClick={() => navMonth(1)} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-colors" aria-label="Next month">
              <ChevronRight size={16} />
            </button>
          </div>
        }
        right={
          <span className="text-white/90 text-sm font-semibold">
            {MONTH_NAMES[month - 1]} {year}
          </span>
        }
      />
      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">

      {error && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl p-3 flex items-center gap-2 text-red-600 dark:text-red-400 text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Cash-flow forecast */}
      <CashFlowForecast />

      {/* Summary bar */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm px-5 py-3 flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400 flex-wrap">
        <span>
          <span className="font-semibold text-gray-900 dark:text-gray-100">{allBillsThisMonth.length}</span>
          {' '}{allBillsThisMonth.length === 1 ? 'bill' : 'bills'} in {MONTH_NAMES[month - 1]}:
          <span className="font-bold text-blue-600 ml-1">{fmt0(totalThisMonth)}</span>
        </span>
        {allPaychecksThisMonth.length > 0 && (
          <span className="text-green-600 dark:text-green-400 font-medium">
            💰 {allPaychecksThisMonth.length} paycheck{allPaychecksThisMonth.length !== 1 ? 's' : ''} · {fmt0(totalIncomeThisMonth)}
          </span>
        )}
        {paidCount > 0 && (
          <span className="flex items-center gap-1 text-green-600 font-medium">
            <CheckCircle2 size={14} />
            {paidCount} paid · {fmt0(paidTotal)}
          </span>
        )}
        {allBillsThisMonth.length - paidCount > 0 && (
          <span className="text-amber-600 font-medium">
            {allBillsThisMonth.length - paidCount} remaining · {fmt0(totalThisMonth - paidTotal)}
          </span>
        )}
      </div>

      {/* Main layout */}
      <div className="flex gap-4 items-start flex-col lg:flex-row">
        {/* Calendar grid */}
        <div className="flex-1 min-w-0 bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-700">
            {DAY_NAMES.map(d => (
              <div key={d} className="py-2 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {cells.map((day, idx) => {
              const bills = day !== null ? (billsByDay[day] ?? []) : []
              const paychecksToday = day !== null ? (paychecksByDay[day] ?? []) : []
              const todayCell = isToday(day)
              return (
                <div
                  key={idx}
                  className={cn(
                    'min-h-[80px] p-1.5 border-b border-r border-gray-100 dark:border-gray-700 flex flex-col gap-1',
                    day === null && 'bg-slate-50 dark:bg-gray-900',
                    idx % 7 === 6 && 'border-r-0',
                  )}
                >
                  {day !== null && (
                    <>
                      <span className={cn(
                        'text-xs font-semibold self-start leading-none px-1 py-0.5 rounded',
                        todayCell ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-400',
                      )}>
                        {day}
                      </span>
                      {paychecksToday.map(({ paycheck }, i) => (
                        <span
                          key={`p-${i}`}
                          title={`${paycheck.source} — ${fmt(paycheck.amount)}`}
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded-full truncate leading-tight bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400"
                        >
                          💰 {fmt(paycheck.amount)}
                        </span>
                      ))}
                      {bills.slice(0, 3).map(({ sub }, i) => {
                        const paid = paidMap[sub.merchant]
                        return (
                          <span
                            key={i}
                            title={`${sub.merchant} — ${fmt(sub.amount)}${paid ? ' ✓ Paid' : ''}`}
                            className={cn(
                              'text-[10px] font-medium px-1.5 py-0.5 rounded-full truncate leading-tight',
                              paid ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 line-through opacity-70' : chipStyle(sub.cadence),
                            )}
                          >
                            {sub.merchant.length > 10 ? sub.merchant.slice(0, 10) + '…' : sub.merchant}{' '}
                            {fmt(sub.amount)}
                          </span>
                        )
                      })}
                      {bills.length > 3 && (
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 pl-1">+{bills.length - 3} more</span>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-full lg:w-72 shrink-0 bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Bills — {MONTH_NAMES[month - 1]}
            </p>
          </div>

          {allBillsThisMonth.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
              No bills scheduled this month.
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700 max-h-[480px] overflow-y-auto">
              {allBillsThisMonth.map(({ sub, day }, i) => {
                const paid = paidMap[sub.merchant]
                const isToggling = toggling === sub.merchant
                return (
                  <li key={i} className="flex items-center gap-3 px-4 py-2.5">
                    <button
                      onClick={() => togglePaid(sub.merchant)}
                      disabled={isToggling}
                      aria-label={paid ? 'Mark unpaid' : 'Mark paid'}
                      className={cn(
                        'shrink-0 transition-colors',
                        paid ? 'text-green-500 hover:text-gray-400' : 'text-gray-300 dark:text-gray-600 hover:text-green-500',
                        isToggling && 'opacity-50',
                      )}
                    >
                      {paid ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                    </button>
                    <span className={cn(
                      'text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0',
                      chipStyle(sub.cadence),
                    )}>
                      {MONTH_NAMES[month - 1].slice(0, 3)} {day}
                    </span>
                    <span className={cn(
                      'flex-1 text-sm text-gray-700 dark:text-gray-300 truncate font-medium',
                      paid && 'line-through text-gray-400 dark:text-gray-500',
                    )}>
                      {sub.merchant}
                    </span>
                    <span className={cn('text-sm font-bold shrink-0', paid ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-gray-100')}>
                      {fmt(sub.amount)}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}

          {allPaychecksThisMonth.length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-700">
              <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  💰 Paychecks — {MONTH_NAMES[month - 1]}
                </p>
              </div>
              <ul className="divide-y divide-gray-100 dark:divide-gray-700 max-h-[240px] overflow-y-auto">
                {allPaychecksThisMonth.map(({ paycheck, day }, i) => (
                  <li key={i} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400">
                      {MONTH_NAMES[month - 1].slice(0, 3)} {day}
                    </span>
                    <span className="flex-1 text-sm text-gray-700 dark:text-gray-300 truncate font-medium">
                      {paycheck.source}
                    </span>
                    <span className="text-sm font-bold text-green-600 dark:text-green-400 shrink-0">
                      {fmt(paycheck.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700">
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-2 font-medium">Cadence</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(CADENCE_CHIP).map(([cadence, cls]) => (
                <span key={cadence} className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full capitalize', cls)}>
                  {cadence}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
