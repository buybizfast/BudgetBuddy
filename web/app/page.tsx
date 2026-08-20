'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  PiggyBank, Receipt, Building2, Target, CreditCard, CalendarDays,
  RefreshCw, BarChart2, ChevronRight, LogOut, TrendingDown, TrendingUp, Wallet, Bell, Shield, LineChart, FileText, Sparkles,
} from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { clearToken } from '@/lib/auth'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useUpcomingBills } from '@/hooks/useUpcomingBills'

const quickLinks = [
  { href: '/budget',        label: 'Budget',        icon: PiggyBank,    color: 'bg-blue-50 text-blue-600' },
  { href: '/transactions',  label: 'Transactions',  icon: Receipt,      color: 'bg-blue-50 text-blue-600' },
  { href: '/accounts',      label: 'Accounts',      icon: Building2,    color: 'bg-purple-50 text-purple-600' },
  { href: '/goals',         label: 'Goals',         icon: Target,       color: 'bg-amber-50 text-amber-600' },
  { href: '/emergency',     label: 'Emergency',     icon: Shield,       color: 'bg-blue-50 text-blue-600' },
  { href: '/debt',          label: 'Debt',          icon: CreditCard,   color: 'bg-red-50 text-red-500' },
  { href: '/subscriptions', label: 'Subscriptions', icon: RefreshCw,    color: 'bg-teal-50 text-teal-600' },
  { href: '/calendar',      label: 'Calendar',      icon: CalendarDays, color: 'bg-indigo-50 text-indigo-600' },
  { href: '/networth',      label: 'Net Worth',     icon: LineChart,    color: 'bg-green-50 text-green-600' },
  { href: '/report',        label: 'Report',        icon: FileText,     color: 'bg-slate-50 text-slate-600' },
  { href: '/coach',         label: 'AI Coach',      icon: Sparkles,     color: 'bg-violet-50 text-violet-600' },
  { href: '/spending',      label: 'Insights',      icon: BarChart2,    color: 'bg-orange-50 text-orange-500' },
]

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function ProgressBar({ value, max, color = 'bg-blue-500' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function DigestButton() {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState('')

  const send = async () => {
    setState('sending')
    setError('')
    try {
      await apiFetch('/api/v1/digest/send', { method: 'POST' })
      setState('sent')
    } catch (e: any) {
      setError(e?.message || 'Could not send digest')
      setState('error')
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Weekly Digest</p>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          {state === 'sent' ? 'Sent! Check your inbox.' : state === 'error' ? error : 'A summary email every Monday morning — or send one now.'}
        </p>
      </div>
      <button onClick={send} disabled={state === 'sending'}
        className="shrink-0 text-xs font-semibold px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl transition-colors">
        {state === 'sending' ? 'Sending…' : 'Email me now'}
      </button>
    </div>
  )
}

export default function TodayPage() {
  const router = useRouter()
  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  const [budget, setBudget] = useState<any>(null)
  const [debts, setDebts] = useState<any[]>([])
  const [goals, setGoals] = useState<any[]>([])
  const [subs, setSubs] = useState<any[]>([])
  const [txns, setTxns] = useState<any[]>([])
  const [safeToSpend, setSafeToSpend] = useState<any>(null)
  const [alerts, setAlerts] = useState<any[]>([])
  const [notifPermission, setNotifPermission] = useState<string>('unsupported')
  const { bills: upcomingBills } = useUpcomingBills(7)

  useEffect(() => {
    apiFetch<any>(`/api/v1/budget/month/${year}/${month}`).then(setBudget).catch(() => {})
    apiFetch<any[]>('/api/v1/debt/').then(setDebts).catch(() => {})
    apiFetch<any[]>('/api/v1/goals/').then(setGoals).catch(() => {})
    apiFetch<any[]>('/api/v1/subscriptions/').then(setSubs).catch(() => {})
    apiFetch<any>(`/api/v1/budget/transactions?year=${year}&month=${month}&limit=5`).then(d => setTxns(d.transactions ?? d)).catch(() => {})
    apiFetch<any>('/api/v1/safe-to-spend/').then(setSafeToSpend).catch(() => {})
    apiFetch<any[]>('/api/v1/insights/alerts').then(setAlerts).catch(() => {})
  }, [year, month])

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotifPermission(Notification.permission)
    }
  }, [])

  // Fire a browser notification for bills due today/tomorrow, once per bill
  // per due date.
  useEffect(() => {
    if (notifPermission !== 'granted' || upcomingBills.length === 0) return
    for (const b of upcomingBills) {
      if (b.days_until > 1) continue
      const key = `billnotif-${b.merchant}-${b.due_date}`
      if (localStorage.getItem(key)) continue
      const when = b.days_until === 0 ? 'today' : 'tomorrow'
      try {
        new Notification(`${b.merchant} is due ${when}`, {
          body: `${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(b.amount)} due ${when}. Make sure the money's there.`,
          icon: '/icon-192.png',
        })
        localStorage.setItem(key, '1')
      } catch {}
    }
  }, [notifPermission, upcomingBills])

  const enableReminders = async () => {
    if (!('Notification' in window)) return
    const perm = await Notification.requestPermission()
    setNotifPermission(perm)
  }

  function logout() {
    clearToken()
    router.push('/login')
  }

  const totalDebt = debts.reduce((s, d) => s + d.balance, 0)
  const totalPaid = debts.reduce((s, d) => s + (d.total_paid ?? 0), 0)
  const debtProgress = totalDebt + totalPaid > 0 ? (totalPaid / (totalDebt + totalPaid)) * 100 : 0

  const totalSaved = goals.reduce((s, g) => s + g.current_amount, 0)
  const totalTarget = goals.reduce((s, g) => s + g.target_amount, 0)

  const upcomingSubs = subs
    .filter(s => s.status === 'active')
    .slice(0, 3)

  const spentPct = budget ? (budget.total_spent / budget.total_income) * 100 : 0
  const overBudget = budget && budget.left_to_budget < 0

  return (
    <div>
      <PageHeader
        title={<>{greeting}! 👋</>}
        subtitle={`${MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`}
        right={
          <button onClick={logout} aria-label="Sign out"
            className="flex items-center gap-1.5 text-blue-200 hover:text-white text-xs font-medium transition-colors">
            <LogOut size={15} />
            Sign out
          </button>
        }
      />

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">

        {/* Safe to Spend */}
        {safeToSpend && (
          <div className={cn(
            'rounded-2xl p-5 shadow-sm text-white',
            safeToSpend.safe_to_spend < 0
              ? 'bg-gradient-to-br from-red-500 to-red-700'
              : safeToSpend.safe_to_spend < 100
                ? 'bg-gradient-to-br from-amber-500 to-orange-600'
                : 'bg-gradient-to-br from-emerald-500 to-teal-700'
          )}>
            <div className="flex items-center gap-2 mb-1">
              <Wallet size={14} className="opacity-80" />
              <p className="text-xs font-semibold uppercase tracking-wider opacity-80">Safe to Spend</p>
            </div>
            <p className="text-3xl font-bold">{fmt(safeToSpend.safe_to_spend)}</p>
            <p className="text-xs opacity-80 mt-1.5">
              {fmt(safeToSpend.cash)} cash − {fmt(safeToSpend.upcoming_bills_total)} in bills
              {safeToSpend.next_paycheck_date
                ? ` before your ${new Date(safeToSpend.next_paycheck_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} paycheck`
                : ' due in the next 30 days'}
            </p>
            {safeToSpend.safe_to_spend < 0 && (
              <p className="text-xs font-semibold mt-1.5 bg-white/20 rounded-lg px-2 py-1 inline-block">
                ⚠ Your upcoming bills exceed your cash — move money or reschedule a bill.
              </p>
            )}
          </div>
        )}

        {/* Bill reminders */}
        {upcomingBills.length > 0 && (
          <Link href="/calendar" className="block bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 hover:bg-amber-100 dark:hover:bg-amber-950/50 transition-colors">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900/40 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                <Bell size={16} className="text-amber-600 dark:text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-amber-900 dark:text-amber-300">
                  {upcomingBills.length === 1
                    ? '1 bill due this week'
                    : `${upcomingBills.length} bills due this week`}
                </p>
                <div className="mt-1 space-y-0.5">
                  {upcomingBills.slice(0, 3).map(b => (
                    <p key={b.merchant} className="text-xs text-amber-700 dark:text-amber-400">
                      {b.merchant} — {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(b.amount)}
                      {' · '}
                      {b.days_until === 0 ? 'today' : b.days_until === 1 ? 'tomorrow' : `in ${b.days_until} days`}
                    </p>
                  ))}
                  {upcomingBills.length > 3 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">+{upcomingBills.length - 3} more</p>
                  )}
                </div>
                {notifPermission === 'default' && (
                  <button
                    onClick={e => { e.preventDefault(); enableReminders() }}
                    className="mt-2 text-xs font-semibold text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 hover:bg-amber-200 dark:hover:bg-amber-900/60 rounded-lg px-2.5 py-1.5 transition-colors">
                    🔔 Notify me when bills are due
                  </button>
                )}
              </div>
              <ChevronRight size={16} className="text-amber-400 dark:text-amber-500 shrink-0 mt-1" />
            </div>
          </Link>
        )}

        {/* Coach flags */}
        {alerts.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-4 pt-4 pb-2">
              <Sparkles size={14} className="text-violet-500" />
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Heads Up</h2>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-gray-700">
              {alerts.map((a, i) => (
                <Link key={i} href={a.href} className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                  <span className={cn(
                    'mt-1 w-2 h-2 rounded-full shrink-0',
                    a.severity === 'alert' ? 'bg-red-500' : a.severity === 'warn' ? 'bg-amber-400' : 'bg-blue-400'
                  )} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{a.title}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{a.detail}</p>
                  </div>
                  <ChevronRight size={14} className="text-gray-300 dark:text-gray-600 shrink-0 mt-1" />
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Budget summary */}
        {budget && (
          <Link href="/budget" className="block bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-5 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400">{MONTHS[month - 1]} Budget</h2>
              <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full',
                overBudget ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400' : 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400')}>
                {overBudget ? 'Over budget' : 'On track'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Income</p>
                <p className="text-base font-bold text-gray-900 dark:text-gray-100">{fmt(budget.total_income)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Spent</p>
                <p className="text-base font-bold text-gray-900 dark:text-gray-100">{fmt(budget.total_spent)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Remaining</p>
                <p className={cn('text-base font-bold', overBudget ? 'text-red-500' : 'text-green-600 dark:text-green-400')}>
                  {fmt(Math.abs(budget.left_to_budget))}
                </p>
              </div>
            </div>
            <ProgressBar value={budget.total_spent} max={budget.total_income}
              color={overBudget ? 'bg-red-400' : spentPct > 80 ? 'bg-amber-400' : 'bg-blue-500'} />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">{Math.round(spentPct)}% of income spent</p>
          </Link>
        )}

        {/* Debt + Goals row */}
        <div className="grid grid-cols-2 gap-4">
          {/* Debt */}
          <Link href="/debt" className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4 hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 bg-red-50 dark:bg-red-900/30 rounded-lg flex items-center justify-center">
                <TrendingDown size={14} className="text-red-500" />
              </div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">Debt</p>
            </div>
            <p className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">{fmt(totalDebt)}</p>
            <ProgressBar value={totalPaid} max={totalDebt + totalPaid} color="bg-red-400" />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{Math.round(debtProgress)}% paid off</p>
          </Link>

          {/* Savings */}
          <Link href="/goals" className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4 hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 bg-amber-50 dark:bg-amber-900/30 rounded-lg flex items-center justify-center">
                <TrendingUp size={14} className="text-amber-500" />
              </div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">Savings</p>
            </div>
            <p className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">{fmt(totalSaved)}</p>
            <ProgressBar value={totalSaved} max={totalTarget} color="bg-amber-400" />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{goals.length} goal{goals.length !== 1 ? 's' : ''}</p>
          </Link>
        </div>

        {/* Upcoming bills */}
        {upcomingSubs.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Upcoming Bills</h2>
              <Link href="/calendar" className="text-xs text-blue-600 font-medium">See all</Link>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-gray-700">
              {upcomingSubs.map(s => (
                <div key={s.merchant} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 bg-teal-50 dark:bg-teal-900/30 rounded-lg flex items-center justify-center">
                      <RefreshCw size={13} className="text-teal-600 dark:text-teal-400" />
                    </div>
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{s.merchant}</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{fmt(s.amount ?? 0)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent transactions */}
        {txns.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Recent Transactions</h2>
              <Link href="/transactions" className="text-xs text-blue-600 font-medium">See all</Link>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-gray-700">
              {txns.slice(0, 5).map((t: any) => (
                <div key={t.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-7 h-7 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center shrink-0">
                      <Wallet size={13} className="text-gray-500 dark:text-gray-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{t.merchant_name || t.name}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">{t.date}</p>
                    </div>
                  </div>
                  <span className={cn('text-sm font-semibold shrink-0 ml-2', t.amount < 0 ? 'text-blue-600' : 'text-red-500')}>
                    {t.amount < 0 ? '+' : ''}{fmt(Math.abs(t.amount))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Weekly digest */}
        <DigestButton />

        {/* Quick access grid */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 pt-4 pb-2">
            <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Quick Access</h2>
          </div>
          <div className="grid grid-cols-4">
            {quickLinks.map(({ href, label, icon: Icon, color }) => (
              <Link key={href} href={href}
                className="flex flex-col items-center justify-center gap-1.5 py-4 px-2 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors border-t border-gray-100 dark:border-gray-700">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
                  <Icon size={18} strokeWidth={2} />
                </div>
                <span className="text-[10px] font-medium text-gray-600 dark:text-gray-400 text-center leading-tight">{label}</span>
              </Link>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
