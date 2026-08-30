'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Loader2, Wallet, AlertTriangle, CheckCircle2, CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'
import { apiFetch } from '@/lib/api'

interface Bill {
  merchant: string
  amount: number
  due_date: string
  days_until: number
}

interface IncomeSource {
  paycheck_id: string
  source: string
  amount: number
}

interface Period {
  sources: IncomeSource[]
  amount: number
  pay_date: string
  period_start: string
  period_end: string
  days_until: number
  bills: Bill[]
  bills_total: number
  leftover: number
  bill_count: number
}

interface PeriodsResponse {
  periods: Period[]
  unassigned_bills: Bill[]
  unassigned_total?: number
  message?: string
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtDay(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function PaychecksPage() {
  const [data, setData] = useState<PeriodsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [paidMap, setPaidMap] = useState<Record<string, boolean>>({})

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      setData(await apiFetch<PeriodsResponse>('/api/v1/paychecks/periods?days_ahead=60'))
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const togglePaid = async (merchant: string, dueDate: string) => {
    const key = `${merchant}|${dueDate}`
    const wasPaid = paidMap[key]
    setPaidMap(m => ({ ...m, [key]: !wasPaid }))
    const d = new Date(dueDate + 'T00:00:00')
    try {
      if (wasPaid) {
        await apiFetch(
          `/api/v1/bills/paid?merchant_name=${encodeURIComponent(merchant)}&year=${d.getFullYear()}&month=${d.getMonth() + 1}`,
          { method: 'DELETE' },
        )
      } else {
        await apiFetch('/api/v1/bills/paid', {
          method: 'POST',
          body: JSON.stringify({ merchant_name: merchant, year: d.getFullYear(), month: d.getMonth() + 1 }),
        })
      }
    } catch {
      setPaidMap(m => ({ ...m, [key]: wasPaid }))
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-blue-600" size={32} />
      </div>
    )
  }

  const periods = data?.periods ?? []
  const unassigned = data?.unassigned_bills ?? []

  return (
    <div>
      <PageHeader title="Paychecks" subtitle="What each paycheck has to cover" />
      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">

        {periods.length === 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-10 text-center">
            <Wallet size={40} className="text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-600 dark:text-gray-300 font-medium">No paycheck schedule yet</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1 max-w-xs mx-auto">
              {data?.message ?? 'Add when you get paid and how often, and your bills will group under the paycheck that covers them.'}
            </p>
            <Link href="/budget" className="inline-block mt-4 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl transition-colors">
              Add a paycheck
            </Link>
          </div>
        )}

        {/* Bills due before the next payday come out of money already banked. */}
        {unassigned.length > 0 && (
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-2xl p-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-amber-900 dark:text-amber-300">
                  Due before your next paycheck — {fmt(data?.unassigned_total ?? 0)}
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5 mb-2">
                  These come out of what&apos;s already in your account.
                </p>
                <div className="space-y-1">
                  {unassigned.map(b => (
                    <div key={`${b.merchant}-${b.due_date}`} className="flex items-center justify-between text-xs">
                      <span className="text-amber-800 dark:text-amber-300 truncate">{b.merchant}</span>
                      <span className="font-semibold text-amber-900 dark:text-amber-200 shrink-0 ml-2">
                        {fmt(b.amount)} · {fmtDate(b.due_date)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {periods.map(p => {
          const short = p.leftover < 0
          return (
            <div key={p.pay_date} className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
              {/* Paycheck header */}
              <div className={cn(
                'px-4 py-3 text-white',
                short ? 'bg-gradient-to-r from-red-500 to-red-700' : 'bg-gradient-to-r from-emerald-600 to-teal-700'
              )}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs opacity-80">
                      {p.days_until === 0 ? 'Today' : p.days_until === 1 ? 'Tomorrow' : `In ${p.days_until} days`}
                      {' · '}covers through {fmtDate(p.period_end)}
                    </p>
                    <p className="font-bold text-sm truncate">{fmtDay(p.pay_date)}</p>
                  </div>
                  <p className="text-lg font-bold shrink-0">{fmt(p.amount)}</p>
                </div>
                {/* Every deposit landing this day, so the total is explainable. */}
                <div className="mt-2 pt-2 border-t border-white/20 space-y-0.5">
                  {p.sources.map((src, i) => (
                    <div key={`${src.paycheck_id}-${i}`} className="flex items-center justify-between text-xs">
                      <span className="opacity-90 truncate">{src.source}</span>
                      <span className="font-semibold shrink-0 ml-2">+{fmt(src.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Bills in this period */}
              {p.bills.length === 0 ? (
                <p className="px-4 py-4 text-xs text-gray-400 dark:text-gray-500 text-center">
                  No bills due in this pay period.
                </p>
              ) : (
                <div className="divide-y divide-gray-50 dark:divide-gray-700">
                  {p.bills.map(b => {
                    const key = `${b.merchant}|${b.due_date}`
                    const paid = paidMap[key]
                    return (
                      <button key={key} onClick={() => togglePaid(b.merchant, b.due_date)}
                        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors text-left">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {paid
                            ? <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />
                            : <span className="w-[15px] h-[15px] rounded-full border-2 border-gray-300 dark:border-gray-600 shrink-0" />}
                          <div className="min-w-0">
                            <p className={cn(
                              'text-sm truncate',
                              paid ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-800 dark:text-gray-200'
                            )}>
                              {b.merchant}
                            </p>
                            <p className="text-xs text-gray-400 dark:text-gray-500">{fmtDate(b.due_date)}</p>
                          </div>
                        </div>
                        <span className={cn(
                          'text-sm font-semibold shrink-0',
                          paid ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-900 dark:text-gray-100'
                        )}>
                          {fmt(b.amount)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Period math */}
              <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900 border-t border-gray-100 dark:border-gray-700 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 dark:text-gray-400">
                    Coming in ({p.sources.length} source{p.sources.length !== 1 ? 's' : ''})
                  </span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">+{fmt(p.amount)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 dark:text-gray-400">
                    Going out ({p.bill_count} bill{p.bill_count !== 1 ? 's' : ''})
                  </span>
                  <span className="text-red-500 font-medium">−{fmt(p.bills_total)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                    {short ? 'Short by' : 'Left after bills'}
                  </span>
                  <span className={cn('text-base font-bold', short ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400')}>
                    {fmt(Math.abs(p.leftover))}
                  </span>
                </div>
                {short && (
                  <p className="text-xs text-red-600 dark:text-red-400 font-medium">
                    This paycheck doesn&apos;t cover its bills — move one to another period or trim spending.
                  </p>
                )}
              </div>
            </div>
          )
        })}

        {periods.length > 0 && (
          <p className="text-center text-xs text-gray-400 dark:text-gray-500 flex items-center justify-center gap-1.5">
            <CalendarDays size={12} />
            Tap a bill to mark it paid · manage paychecks on the{' '}
            <Link href="/budget" className="text-blue-600 hover:text-blue-700 font-medium">Budget page</Link>
          </p>
        )}
      </div>
    </div>
  )
}
