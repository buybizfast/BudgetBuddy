'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  PiggyBank, Receipt, Building2, Target, CreditCard, CalendarDays,
  RefreshCw, BarChart2, ChevronRight, LogOut, TrendingDown, TrendingUp, Wallet, Bell,
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
  { href: '/debt',          label: 'Debt',          icon: CreditCard,   color: 'bg-red-50 text-red-500' },
  { href: '/subscriptions', label: 'Subscriptions', icon: RefreshCw,    color: 'bg-teal-50 text-teal-600' },
  { href: '/calendar',      label: 'Calendar',      icon: CalendarDays, color: 'bg-indigo-50 text-indigo-600' },
  { href: '/spending',      label: 'Insights',      icon: BarChart2,    color: 'bg-orange-50 text-orange-500' },
]

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function ProgressBar({ value, max, color = 'bg-blue-500' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
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
  const { bills: upcomingBills } = useUpcomingBills(7)

  useEffect(() => {
    apiFetch<any>(`/api/v1/budget/month/${year}/${month}`).then(setBudget).catch(() => {})
    apiFetch<any[]>('/api/v1/debt/').then(setDebts).catch(() => {})
    apiFetch<any[]>('/api/v1/goals/').then(setGoals).catch(() => {})
    apiFetch<any[]>('/api/v1/subscriptions/').then(setSubs).catch(() => {})
    apiFetch<any>(`/api/v1/budget/transactions?year=${year}&month=${month}&limit=5`).then(d => setTxns(d.transactions ?? d)).catch(() => {})
  }, [year, month])

  function logout() {
    clearToken()
    router.push('/login')
  }

  const totalDebt = debts.reduce((s, d) => s + d.balance, 0)
  const totalPaid = debts.reduce((s, d) => s + (d.total_paid ?? 0), 0)
  const debtProgress = totalDebt + totalPaid > 0 ? (totalPaid / (totalDebt + totalPaid)) * 100 : 0

  const totalSaved = goals.reduce((s, g) => s + g.current_amount, 0)
  const totalTarget = goals.reduce((s, g) => s + g.target_amount, 0)

  const upcomingBills = subs
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

        {/* Bill reminders */}
        {upcomingBills.length > 0 && (
          <Link href="/calendar" className="block bg-amber-50 border border-amber-200 rounded-2xl p-4 hover:bg-amber-100 transition-colors">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-amber-100 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                <Bell size={16} className="text-amber-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-amber-900">
                  {upcomingBills.length === 1
                    ? '1 bill due this week'
                    : `${upcomingBills.length} bills due this week`}
                </p>
                <div className="mt-1 space-y-0.5">
                  {upcomingBills.slice(0, 3).map(b => (
                    <p key={b.merchant} className="text-xs text-amber-700">
                      {b.merchant} — {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(b.amount)}
                      {' · '}
                      {b.days_until === 0 ? 'today' : b.days_until === 1 ? 'tomorrow' : `in ${b.days_until} days`}
                    </p>
                  ))}
                  {upcomingBills.length > 3 && (
                    <p className="text-xs text-amber-600 font-medium">+{upcomingBills.length - 3} more</p>
                  )}
                </div>
              </div>
              <ChevronRight size={16} className="text-amber-400 shrink-0 mt-1" />
            </div>
          </Link>
        )}

        {/* Budget summary */}
        {budget && (
          <Link href="/budget" className="block bg-white rounded-2xl shadow-sm p-5 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-500">{MONTHS[month - 1]} Budget</h2>
              <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full',
                overBudget ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700')}>
                {overBudget ? 'Over budget' : 'On track'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Income</p>
                <p className="text-base font-bold text-gray-900">{fmt(budget.total_income)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Spent</p>
                <p className="text-base font-bold text-gray-900">{fmt(budget.total_spent)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Remaining</p>
                <p className={cn('text-base font-bold', overBudget ? 'text-red-500' : 'text-green-600')}>
                  {fmt(Math.abs(budget.left_to_budget))}
                </p>
              </div>
            </div>
            <ProgressBar value={budget.total_spent} max={budget.total_income}
              color={overBudget ? 'bg-red-400' : spentPct > 80 ? 'bg-amber-400' : 'bg-blue-500'} />
            <p className="text-xs text-gray-400 mt-1.5">{Math.round(spentPct)}% of income spent</p>
          </Link>
        )}

        {/* Debt + Goals row */}
        <div className="grid grid-cols-2 gap-4">
          {/* Debt */}
          <Link href="/debt" className="bg-white rounded-2xl shadow-sm p-4 hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 bg-red-50 rounded-lg flex items-center justify-center">
                <TrendingDown size={14} className="text-red-500" />
              </div>
              <p className="text-xs font-semibold text-gray-500">Debt</p>
            </div>
            <p className="text-lg font-bold text-gray-900 mb-1">{fmt(totalDebt)}</p>
            <ProgressBar value={totalPaid} max={totalDebt + totalPaid} color="bg-red-400" />
            <p className="text-xs text-gray-400 mt-1">{Math.round(debtProgress)}% paid off</p>
          </Link>

          {/* Savings */}
          <Link href="/goals" className="bg-white rounded-2xl shadow-sm p-4 hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 bg-amber-50 rounded-lg flex items-center justify-center">
                <TrendingUp size={14} className="text-amber-500" />
              </div>
              <p className="text-xs font-semibold text-gray-500">Savings</p>
            </div>
            <p className="text-lg font-bold text-gray-900 mb-1">{fmt(totalSaved)}</p>
            <ProgressBar value={totalSaved} max={totalTarget} color="bg-amber-400" />
            <p className="text-xs text-gray-400 mt-1">{goals.length} goal{goals.length !== 1 ? 's' : ''}</p>
          </Link>
        </div>

        {/* Upcoming bills */}
        {upcomingBills.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <h2 className="text-sm font-semibold text-gray-700">Upcoming Bills</h2>
              <Link href="/calendar" className="text-xs text-blue-600 font-medium">See all</Link>
            </div>
            <div className="divide-y divide-gray-50">
              {upcomingBills.map(s => (
                <div key={s.merchant} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 bg-teal-50 rounded-lg flex items-center justify-center">
                      <RefreshCw size={13} className="text-teal-600" />
                    </div>
                    <span className="text-sm font-medium text-gray-800">{s.merchant}</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900">{fmt(s.amount ?? 0)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent transactions */}
        {txns.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <h2 className="text-sm font-semibold text-gray-700">Recent Transactions</h2>
              <Link href="/transactions" className="text-xs text-blue-600 font-medium">See all</Link>
            </div>
            <div className="divide-y divide-gray-50">
              {txns.slice(0, 5).map((t: any) => (
                <div key={t.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-7 h-7 bg-gray-100 rounded-lg flex items-center justify-center shrink-0">
                      <Wallet size={13} className="text-gray-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{t.merchant_name || t.name}</p>
                      <p className="text-xs text-gray-400">{t.date}</p>
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-gray-900 shrink-0 ml-2">{fmt(t.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick access grid */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 pt-4 pb-2">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Quick Access</h2>
          </div>
          <div className="grid grid-cols-4">
            {quickLinks.map(({ href, label, icon: Icon, color }) => (
              <Link key={href} href={href}
                className="flex flex-col items-center justify-center gap-1.5 py-4 px-2 hover:bg-gray-50 transition-colors border-t border-gray-100">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
                  <Icon size={18} strokeWidth={2} />
                </div>
                <span className="text-[10px] font-medium text-gray-600 text-center leading-tight">{label}</span>
              </Link>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
