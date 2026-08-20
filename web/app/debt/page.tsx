'use client'
import { useState, useEffect, useCallback } from 'react'
import { CreditCard, Plus, Trash2, ChevronDown, ChevronUp, Loader2, Calculator, DollarSign, CalendarClock, TrendingDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'

import { apiFetch, BASE } from '@/lib/api'

interface Debt {
  id: string; name: string; balance: number; original_balance: number; total_paid: number
  interest_rate: number; minimum_payment: number; payments: Payment[]
  account_type: string; due_date_day: number | null; statement_date_day: number | null
  expected_payoff_months: number | null; expected_payoff_date: string | null
  is_paid_off: boolean; is_synced: boolean; credit_limit: number | null
  total_installments: number | null; installments_paid: number
}

interface Payment { id: string; amount: number; paid_on: string; note: string | null }

const ACCOUNT_TYPES = [
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'loan', label: 'Loan' },
  { value: 'student_loan', label: 'Student Loan' },
  { value: 'auto_loan', label: 'Auto Loan' },
  { value: 'personal_loan', label: 'Personal Loan' },
  { value: 'bnpl', label: 'Buy Now, Pay Later' },
  { value: 'other', label: 'Other' },
]

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function fmtMonthYear(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

interface PlanDebt { id: string; name: string; balance: number; minimum_payment: number; interest_rate: number; payoff_month: number; budgeted_extra: number; payoff_date?: string }


interface SchedulePayment { id: string; name: string; payment: number; balance: number }

interface SchedulePoint { month: number; date: string; total_balance: number; payments: SchedulePayment[] }

interface StrategyPlan { debts: Required<PlanDebt>[]; total_months: number; total_interest: number; strategy: string; total_budgeted_extra: number; schedule: SchedulePoint[] }

interface ComparePlan { snowball: StrategyPlan; avalanche: StrategyPlan }

const SNOWBALL_COLOR = '#3b82f6'
const AVALANCHE_COLOR = '#d97706'

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function fmt0(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

function DebtMilestones({ debts, totalPaid, totalOriginal }: { debts: Debt[]; totalPaid: number; totalOriginal: number }) {
  const overallPct = totalOriginal > 0 ? (totalPaid / totalOriginal) * 100 : 0
  const paidOff = debts.filter(d => d.is_paid_off)

  const milestones: { emoji: string; label: string; achieved: boolean }[] = [
    { emoji: '🏁', label: 'Started your debt-free journey', achieved: debts.length > 0 && totalPaid > 0 },
    { emoji: '🎯', label: '25% of all debt paid', achieved: overallPct >= 25 },
    { emoji: '⚡', label: 'Halfway there — 50% paid', achieved: overallPct >= 50 },
    { emoji: '🔥', label: '75% paid — the home stretch', achieved: overallPct >= 75 },
    { emoji: '🏆', label: 'Completely debt free', achieved: debts.length > 0 && debts.every(d => d.is_paid_off) },
  ]
  const achieved = milestones.filter(m => m.achieved)
  const next = milestones.find(m => !m.achieved)

  if (debts.length === 0) return null

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">Milestones</p>
        <p className="text-xs text-gray-400 dark:text-gray-500">{achieved.length} of {milestones.length}</p>
      </div>
      {paidOff.length > 0 && (
        <div className="mb-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl px-3 py-2">
          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            🎉 {paidOff.length === 1
              ? `${paidOff[0].name} is paid off!`
              : `${paidOff.length} debts crushed: ${paidOff.map(d => d.name).join(', ')}`}
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {milestones.map(m => (
          <span key={m.label} title={m.label}
            className={cn('text-xs px-2.5 py-1.5 rounded-full border font-medium flex items-center gap-1',
              m.achieved
                ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                : 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-600 grayscale opacity-60')}>
            {m.emoji} {m.label}
          </span>
        ))}
      </div>
      {next && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2.5">
          Next up: {next.emoji} {next.label}
          {next.label.includes('25%') && ` — ${fmt(Math.max(0, totalOriginal * 0.25 - totalPaid))} to go`}
          {next.label.includes('50%') && ` — ${fmt(Math.max(0, totalOriginal * 0.5 - totalPaid))} to go`}
          {next.label.includes('75%') && ` — ${fmt(Math.max(0, totalOriginal * 0.75 - totalPaid))} to go`}
        </p>
      )}
    </div>
  )
}

export default function DebtPage() {
  const [debts, setDebts] = useState<Debt[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedDebt, setExpandedDebt] = useState<string | null>(null)
  const [paymentInputs, setPaymentInputs] = useState<Record<string, { amount: string; note: string }>>({})
  const [payingId, setPayingId] = useState<string | null>(null)
  const [detailsModalDebt, setDetailsModalDebt] = useState<Debt | null>(null)
  const [savingDetailsId, setSavingDetailsId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState({
    name: '', balance: '', interest_rate: '', minimum_payment: '',
    account_type: 'loan', due_date_day: '', statement_date_day: '', total_installments: '',
  })
  const [addingDebt, setAddingDebt] = useState(false)

  // Only toggles the page-level spinner on first load. Mutation handlers
  // (payments, details edits, deletes) call fetchDebts() afterward too — if
  // that also flipped `loading`, the whole page (including any open modal)
  // would flash to a full-screen spinner and back on every save.
  const fetchDebts = useCallback(async () => {
    try {
      const res = await apiFetch<any[]>(`/api/v1/debt/`)
      setDebts(res)
    } catch { setDebts([]) }
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchDebts().finally(() => setLoading(false))
  }, [fetchDebts])

  const logPayment = async (debtId: string) => {
    const inp = paymentInputs[debtId]
    if (!inp?.amount) return
    setPayingId(debtId)
    try {
      await apiFetch(`/api/v1/debt/${debtId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: parseFloat(inp.amount), paid_on: new Date().toISOString().slice(0, 10), note: inp.note || null })
      })
      await fetchDebts()
      setPaymentInputs(p => ({ ...p, [debtId]: { amount: '', note: '' } }))
    } catch {} finally { setPayingId(null) }
  }

  const saveDetails = async (debtId: string, details: {
    account_type: string; minimum_payment: string; interest_rate: string; original_balance: string; credit_limit: string
  }) => {
    setSavingDetailsId(debtId)
    setSaveError(null)
    const patch = {
      account_type: details.account_type,
      minimum_payment: details.minimum_payment !== '' ? parseFloat(details.minimum_payment) : null,
      interest_rate: details.interest_rate !== '' ? parseFloat(details.interest_rate) : null,
      original_balance: details.original_balance !== '' ? parseFloat(details.original_balance) : null,
      credit_limit: details.credit_limit !== '' ? parseFloat(details.credit_limit) : null,
    }
    // Apply immediately so the modal closes and numbers update without
    // waiting on a round trip; fetchDebts() below reconciles with
    // server-computed fields (payoff estimate, etc.) right after.
    setDebts(prev => prev.map(d => d.id === debtId ? {
      ...d,
      account_type: patch.account_type,
      minimum_payment: patch.minimum_payment ?? d.minimum_payment,
      interest_rate: patch.interest_rate ?? d.interest_rate,
      original_balance: patch.original_balance ?? d.original_balance,
      credit_limit: patch.credit_limit ?? d.credit_limit,
    } : d))
    setDetailsModalDebt(null)
    try {
      await apiFetch(`/api/v1/debt/${debtId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      })
      await fetchDebts()
    } catch {
      setSaveError('Failed to save debt details — please try again.')
      await fetchDebts()
    } finally { setSavingDetailsId(null) }
  }

  const deleteDebt = async (id: string) => {
    setDeletingId(id)
    try {
      await apiFetch(`/api/v1/debt/${id}`, { method: 'DELETE' })
      await fetchDebts()
    } catch {} finally { setDeletingId(null); setConfirmDelete(null) }
  }

  const addDebt = async () => {
    if (!addForm.name || !addForm.balance) return
    setAddingDebt(true)
    try {
      await apiFetch(`/api/v1/debt/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: addForm.name,
          balance: parseFloat(addForm.balance),
          interest_rate: parseFloat(addForm.interest_rate || '0'),
          minimum_payment: parseFloat(addForm.minimum_payment || '0'),
          account_type: addForm.account_type,
          due_date_day: addForm.due_date_day ? parseInt(addForm.due_date_day) : null,
          statement_date_day: addForm.account_type === 'credit_card' && addForm.statement_date_day ? parseInt(addForm.statement_date_day) : null,
          total_installments: addForm.account_type === 'bnpl' && addForm.total_installments ? parseInt(addForm.total_installments) : null,
        })
      })
      await fetchDebts()
      setAddForm({ name: '', balance: '', interest_rate: '', minimum_payment: '', account_type: 'loan', due_date_day: '', statement_date_day: '', total_installments: '' })
      setShowAddForm(false)
    } catch {} finally { setAddingDebt(false) }
  }

  const totalBalance = debts.reduce((s, d) => s + d.balance, 0)
  const totalPaid = debts.reduce((s, d) => s + d.total_paid, 0)
  const totalOriginal = totalBalance + totalPaid

  const creditCardsWithLimit = debts.filter(d => d.account_type === 'credit_card' && d.credit_limit)
  const totalCreditBalance = creditCardsWithLimit.reduce((s, d) => s + d.balance, 0)
  const totalCreditLimit = creditCardsWithLimit.reduce((s, d) => s + (d.credit_limit ?? 0), 0)
  const utilization = totalCreditLimit > 0 ? (totalCreditBalance / totalCreditLimit) * 100 : null
  const utilizationColor = (pct: number) => pct >= 70 ? 'text-red-500' : pct >= 30 ? 'text-amber-500' : 'text-emerald-500'
  const utilizationBarColor = (pct: number) => pct >= 70 ? 'bg-red-500' : pct >= 30 ? 'bg-amber-400' : 'bg-emerald-500'

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="animate-spin text-blue-600" size={32} />
    </div>
  )

  return (
    <div>
      <PageHeader
        title="Debt Payoff"
        right={
          <button onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-1.5 text-xs px-3 py-2 bg-[#1a2e4a] hover:bg-[#162540] rounded-2xl text-white transition-colors font-semibold">
            <Plus size={12} />Add Debt
          </button>
        }
      />
      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">

      {saveError && (
        <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl px-4 py-2.5 flex items-center justify-between text-sm text-red-600 dark:text-red-300">
          {saveError}
          <button onClick={() => setSaveError(null)} aria-label="Dismiss" className="text-red-400 hover:text-red-600 dark:hover:text-red-200 ml-3">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Total Remaining</p>
          <p className="text-xl font-bold text-red-500">{fmt(totalBalance)}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{debts.length} debts</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Total Paid</p>
          <p className="text-xl font-bold text-blue-600">{fmt(Math.max(0, totalPaid))}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">of {fmt(totalOriginal)}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Progress</p>
          <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {totalOriginal > 0 ? Math.round((totalPaid / totalOriginal) * 100) : 0}%
          </p>
          <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full mt-2 overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all"
              style={{ width: `${totalOriginal > 0 ? Math.min(100, (totalPaid / totalOriginal) * 100) : 0}%` }} />
          </div>
        </div>
      </div>

      <DebtMilestones debts={debts} totalPaid={totalPaid} totalOriginal={totalOriginal} />

      {utilization !== null && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">Credit Utilization</p>
            <p className={cn('text-sm font-bold', utilizationColor(utilization))}>{utilization.toFixed(1)}%</p>
          </div>
          <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
            <div className={cn('h-full rounded-full transition-all', utilizationBarColor(utilization))}
              style={{ width: `${Math.min(100, utilization)}%` }} />
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
            {fmt(totalCreditBalance)} of {fmt(totalCreditLimit)} across {creditCardsWithLimit.length} card{creditCardsWithLimit.length !== 1 ? 's' : ''} · keep under 30% for the best credit impact
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4">
        <div className="space-y-3">
          {showAddForm && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Add New Debt</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block font-medium">Debt Name *</label>
                  <input value={addForm.name} onChange={e => setAddForm(f => ({...f, name: e.target.value}))}
                    placeholder="e.g. Chase Credit Card"
                    className="w-full bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm rounded-xl px-3 py-2 border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block font-medium">Current Balance *</label>
                  <input type="number" value={addForm.balance} onChange={e => setAddForm(f => ({...f, balance: e.target.value}))}
                    placeholder="0.00"
                    className="w-full bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm rounded-xl px-3 py-2 border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block font-medium">Interest Rate (%)</label>
                  <input type="number" value={addForm.interest_rate} onChange={e => setAddForm(f => ({...f, interest_rate: e.target.value}))}
                    placeholder="0.00"
                    className="w-full bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm rounded-xl px-3 py-2 border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block font-medium">Minimum Payment</label>
                  <input type="number" value={addForm.minimum_payment} onChange={e => setAddForm(f => ({...f, minimum_payment: e.target.value}))}
                    placeholder="0.00"
                    className="w-full bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm rounded-xl px-3 py-2 border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block font-medium">Account Type</label>
                  <select value={addForm.account_type} onChange={e => setAddForm(f => ({...f, account_type: e.target.value}))}
                    className="w-full bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm rounded-xl px-3 py-2 border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                    {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block font-medium">Due Date (day of month)</label>
                  <input type="number" min="1" max="31" value={addForm.due_date_day} onChange={e => setAddForm(f => ({...f, due_date_day: e.target.value}))}
                    placeholder="e.g. 15"
                    className="w-full bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm rounded-xl px-3 py-2 border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                </div>
                {addForm.account_type === 'credit_card' && (
                  <div>
                    <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block font-medium">Statement Date (day of month)</label>
                    <input type="number" min="1" max="31" value={addForm.statement_date_day} onChange={e => setAddForm(f => ({...f, statement_date_day: e.target.value}))}
                      placeholder="e.g. 3"
                      className="w-full bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm rounded-xl px-3 py-2 border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                  </div>
                )}
                {addForm.account_type === 'bnpl' && (
                  <div>
                    <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block font-medium">Total Installments</label>
                    <input type="number" min="1" value={addForm.total_installments} onChange={e => setAddForm(f => ({...f, total_installments: e.target.value}))}
                      placeholder="e.g. 4"
                      className="w-full bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm rounded-xl px-3 py-2 border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={addDebt} disabled={addingDebt}
                  className="text-sm px-4 py-2 bg-[#1a2e4a] hover:bg-[#162540] text-white rounded-2xl transition-colors disabled:opacity-50 flex items-center gap-1.5 font-semibold">
                  {addingDebt ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  Add Debt
                </button>
                <button onClick={() => setShowAddForm(false)} className="text-sm px-4 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-xl transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {debts.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-12 text-center">
              <CreditCard size={40} className="text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-gray-600 dark:text-gray-300 font-medium">No debts added</p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Add your debts to start your payoff plan.</p>
            </div>
          ) : (
            debts.map(debt => {
              const originalBalance = debt.original_balance
              const paid = debt.total_paid
              const pct = originalBalance > 0 ? Math.min(100, (paid / originalBalance) * 100) : 0
              const expanded = expandedDebt === debt.id
              const inp = paymentInputs[debt.id] || { amount: '', note: '' }
              const needsDetails = debt.is_synced && (debt.minimum_payment <= 0 || debt.interest_rate <= 0)

              return (
                <div key={debt.id} className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors"
                    onClick={() => setExpandedDebt(expanded ? null : debt.id)}>
                    <div className="flex items-center gap-3">
                      <CreditCard size={15} className="text-red-400 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{debt.name}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">
                          {debt.interest_rate > 0 ? `${debt.interest_rate}% APR · ` : ''}
                          Min. payment: {fmt(debt.minimum_payment)}
                        </p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {debt.total_installments && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400">
                              {debt.installments_paid} of {debt.total_installments} payments
                            </span>
                          )}
                          {debt.is_synced && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400">
                              Synced
                            </span>
                          )}
                          {debt.account_type === 'credit_card' && debt.credit_limit && (
                            <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-50 dark:bg-gray-900',
                              utilizationColor((debt.balance / debt.credit_limit) * 100))}>
                              {((debt.balance / debt.credit_limit) * 100).toFixed(0)}% utilized
                            </span>
                          )}
                          {debt.due_date_day && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 flex items-center gap-0.5">
                              <CalendarClock size={9} />Due {ordinal(debt.due_date_day)}
                            </span>
                          )}
                          {debt.account_type === 'credit_card' && debt.statement_date_day && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400">
                              Statement {ordinal(debt.statement_date_day)}
                            </span>
                          )}
                          {debt.expected_payoff_date && !debt.is_paid_off && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 flex items-center gap-0.5">
                              <TrendingDown size={9} />Payoff {fmtMonthYear(debt.expected_payoff_date)}
                            </span>
                          )}
                          {debt.expected_payoff_months === null && !debt.is_paid_off && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400">
                              Min. payment too low
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-sm font-bold text-red-500">{fmt(debt.balance)}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">{Math.round(pct)}% paid off</p>
                      </div>
                      {expanded ? <ChevronUp size={14} className="text-gray-400 dark:text-gray-500" /> : <ChevronDown size={14} className="text-gray-400 dark:text-gray-500" />}
                    </div>
                  </div>

                  <div className="h-1 bg-gray-100 dark:bg-gray-700 mx-4">
                    <div className="h-full bg-blue-500 transition-all rounded-full" style={{ width: `${pct}%` }} />
                  </div>

                  {expanded && (
                    <div className="px-4 py-3 space-y-3 border-t border-gray-100 dark:border-gray-700 mt-1">
                      {debt.is_synced ? (
                        <p className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
                          <DollarSign size={11} />Balance updates automatically from your bank — no need to log payments here.
                        </p>
                      ) : (
                        <div>
                          <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-2 flex items-center gap-1">
                            <DollarSign size={11} />Log Payment
                          </p>
                          <div className="flex items-center gap-2">
                            <input type="number" value={inp.amount} placeholder="Amount"
                              onChange={e => setPaymentInputs(p => ({ ...p, [debt.id]: { ...inp, amount: e.target.value } }))}
                              className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-xs rounded-xl px-2 py-1.5 w-28 border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            <input value={inp.note} placeholder="Note (optional)"
                              onChange={e => setPaymentInputs(p => ({ ...p, [debt.id]: { ...inp, note: e.target.value } }))}
                              className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-xs rounded-xl px-2 py-1.5 flex-1 border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            <button onClick={() => logPayment(debt.id)} disabled={payingId === debt.id || !inp.amount}
                              className="text-xs px-3 py-1.5 bg-[#1a2e4a] hover:bg-[#162540] text-white rounded-2xl transition-colors disabled:opacity-50 flex items-center gap-1 font-semibold">
                              {payingId === debt.id ? <Loader2 size={10} className="animate-spin" /> : null}
                              Log
                            </button>
                          </div>
                        </div>
                      )}

                      <div>
                        <button onClick={() => setDetailsModalDebt(debt)}
                          className="text-xs px-3 py-1.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 hover:border-blue-400 hover:text-blue-600 text-gray-700 dark:text-gray-300 rounded-2xl transition-colors flex items-center gap-1.5 font-semibold">
                          <Calculator size={11} />Debt Details
                          {needsDetails && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400">
                              needed for payoff estimate
                            </span>
                          )}
                        </button>
                      </div>

                      {debt.payments.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-2">Payment History</p>
                          <div className="space-y-1.5">
                            {debt.payments.slice(0, 5).map(p => (
                              <div key={p.id} className="flex justify-between text-xs">
                                <span className="text-gray-400 dark:text-gray-500">{p.paid_on} {p.note && <span className="text-gray-300 dark:text-gray-600">— {p.note}</span>}</span>
                                <span className="text-blue-600 font-medium">{fmt(p.amount)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="pt-1 border-t border-gray-100 dark:border-gray-700">
                        {confirmDelete === debt.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 dark:text-gray-400">Delete {debt.name}?</span>
                            <button onClick={() => deleteDebt(debt.id)} disabled={deletingId === debt.id}
                              className="text-xs px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded transition-colors disabled:opacity-50">
                              {deletingId === debt.id ? <Loader2 size={10} className="animate-spin inline" /> : 'Delete'}
                            </button>
                            <button onClick={() => setConfirmDelete(null)} className="text-xs px-2 py-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-xl transition-colors">
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmDelete(debt.id)}
                            className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors flex items-center gap-1">
                            <Trash2 size={11} />Remove debt
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

      </div>

      {debts.length > 0 && <PayoffForecast />}
      </div>

      {detailsModalDebt && (
        <DebtDetailsModal
          debt={detailsModalDebt}
          saving={savingDetailsId === detailsModalDebt.id}
          onSave={details => saveDetails(detailsModalDebt.id, details)}
          onClose={() => setDetailsModalDebt(null)}
        />
      )}
    </div>
  )
}

function DebtDetailsModal({ debt, saving, onSave, onClose }: {
  debt: Debt
  saving: boolean
  onSave: (details: { account_type: string; minimum_payment: string; interest_rate: string; original_balance: string; credit_limit: string }) => void
  onClose: () => void
}) {
  const [accountType, setAccountType] = useState(debt.account_type)
  const [minimumPayment, setMinimumPayment] = useState(String(debt.minimum_payment))
  const [interestRate, setInterestRate] = useState(String(debt.interest_rate))
  const [originalBalance, setOriginalBalance] = useState(String(debt.original_balance))
  const [creditLimit, setCreditLimit] = useState(debt.credit_limit !== null ? String(debt.credit_limit) : '')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Debt Details</h3>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 -mt-2">{debt.name}</p>

        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block font-medium">Debt Type</label>
          <select value={accountType} onChange={e => setAccountType(e.target.value)}
            className="w-full bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm rounded-xl px-3 py-2 border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent">
            {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block font-medium">Minimum Payment</label>
            <input type="number" value={minimumPayment} onChange={e => setMinimumPayment(e.target.value)}
              placeholder="0.00"
              className="w-full bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm rounded-xl px-3 py-2 border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
          </div>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block font-medium">Interest Rate (%)</label>
            <input type="number" value={interestRate} onChange={e => setInterestRate(e.target.value)}
              placeholder="0.00"
              className="w-full bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm rounded-xl px-3 py-2 border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block font-medium">Original Balance</label>
          <input type="number" value={originalBalance} onChange={e => setOriginalBalance(e.target.value)}
            placeholder="0.00"
            className="w-full bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm rounded-xl px-3 py-2 border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">Used to calculate % paid off — defaults to current balance + payments logged if left blank.</p>
        </div>

        {accountType === 'credit_card' && (
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block font-medium">Credit Limit</label>
            <input type="number" value={creditLimit} onChange={e => setCreditLimit(e.target.value)}
              placeholder="0.00"
              className="w-full bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm rounded-xl px-3 py-2 border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">Used for utilization — set this if your bank doesn't report a limit to Plaid. Synced limits take priority when available.</p>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onSave({ account_type: accountType, minimum_payment: minimumPayment, interest_rate: interestRate, original_balance: originalBalance, credit_limit: creditLimit })}
            disabled={saving}
            className="flex-1 text-sm py-2 bg-[#1a2e4a] hover:bg-[#162540] disabled:opacity-50 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            Save
          </button>
          <button onClick={onClose}
            className="text-sm px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-xl transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function PayoffForecast() {
  const [extra, setExtra] = useState('0')
  const [compare, setCompare] = useState<ComparePlan | null>(null)
  const [loadingCompare, setLoadingCompare] = useState(true)
  const [hoverMonth, setHoverMonth] = useState<number | null>(null)
  const [scheduleStrategy, setScheduleStrategy] = useState<'snowball' | 'avalanche'>('snowball')
  const [scheduleView, setScheduleView] = useState<'list' | 'calendar'>('list')

  useEffect(() => {
    const extraNum = parseFloat(extra) || 0
    setLoadingCompare(true)
    const t = setTimeout(() => {
      apiFetch<ComparePlan>(`/api/v1/debt/plan/compare?extra_monthly=${extraNum}`)
        .then(setCompare)
        .catch(() => setCompare(null))
        .finally(() => setLoadingCompare(false))
    }, 350)
    return () => clearTimeout(t)
  }, [extra])

  const W = 640, H = 220, padL = 54, padR = 12, padT = 12, padB = 8
  const plotW = W - padL - padR, plotH = H - padT - padB

  const maxMonths = compare ? Math.max(compare.snowball.total_months, compare.avalanche.total_months, 1) : 1
  const maxBalance = compare
    ? Math.max(compare.snowball.schedule[0]?.total_balance ?? 0, compare.avalanche.schedule[0]?.total_balance ?? 0, 1)
    : 1
  const x = (m: number) => padL + (m / maxMonths) * plotW
  const y = (bal: number) => padT + plotH - (bal / maxBalance) * plotH
  const pathFor = (schedule: SchedulePoint[]) =>
    schedule.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.month).toFixed(1)} ${y(p.total_balance).toFixed(1)}`).join(' ')
  const pointAt = (schedule: SchedulePoint[], month: number) =>
    schedule.find(p => p.month === month) ?? schedule[schedule.length - 1]

  const handleMove = (e: any) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const svgX = ((e.clientX - rect.left) / rect.width) * W
    const month = Math.round(((svgX - padL) / plotW) * maxMonths)
    setHoverMonth(Math.max(0, Math.min(maxMonths, month)))
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4">
      <div className="flex items-center gap-2 mb-1">
        <TrendingDown size={14} className="text-blue-600" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Payoff Forecast</h3>
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
        Try a sample extra monthly payment and see how it changes your timeline under both strategies.
      </p>

      <div className="flex items-end gap-3 mb-4 flex-wrap">
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block font-medium">Sample Extra Monthly Payment</label>
          <div className="flex items-center gap-1">
            <span className="text-gray-400 dark:text-gray-500 text-sm">$</span>
            <input type="number" min="0" value={extra} onChange={e => setExtra(e.target.value)}
              className="w-32 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm rounded-xl px-2 py-1.5 border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <input type="range" min="0" max="2000" step="25" value={Math.min(parseFloat(extra) || 0, 2000)}
          onChange={e => setExtra(e.target.value)}
          aria-label="Sample extra monthly payment"
          className="flex-1 min-w-[140px] accent-blue-600 mb-2" />
        {loadingCompare && <Loader2 size={14} className="animate-spin text-gray-400 mb-2 shrink-0" />}
      </div>

      {!compare ? (
        <div className="flex justify-center py-10">
          <Loader2 size={16} className="animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-4 mb-2 flex-wrap text-xs">
            <span className="flex items-center gap-1.5 font-medium text-gray-700 dark:text-gray-300">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: SNOWBALL_COLOR }} />
              Snowball — {compare.snowball.total_months} mo, {fmt(compare.snowball.total_interest)} interest
            </span>
            <span className="flex items-center gap-1.5 font-medium text-gray-700 dark:text-gray-300">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: AVALANCHE_COLOR }} />
              Avalanche — {compare.avalanche.total_months} mo, {fmt(compare.avalanche.total_interest)} interest
            </span>
          </div>

          {(() => {
            const monthsSaved = Math.abs(compare.snowball.total_months - compare.avalanche.total_months)
            const fasterStrategy = compare.snowball.total_months <= compare.avalanche.total_months ? 'Snowball' : 'Avalanche'
            const interestSaved = Math.abs(compare.snowball.total_interest - compare.avalanche.total_interest)
            const cheaperStrategy = compare.snowball.total_interest <= compare.avalanche.total_interest ? 'Snowball' : 'Avalanche'
            return (monthsSaved > 0 || interestSaved > 1) && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 mb-3">
                {monthsSaved > 0 && `${fasterStrategy} finishes ${monthsSaved} mo sooner. `}
                {interestSaved > 1 && `${cheaperStrategy} saves ${fmt(interestSaved)} in interest.`}
              </p>
            )
          })()}

          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto touch-none"
            onMouseMove={handleMove} onMouseLeave={() => setHoverMonth(null)}>
            {[0, 0.25, 0.5, 0.75, 1].map(f => (
              <line key={f} x1={padL} x2={W - padR} y1={padT + plotH * f} y2={padT + plotH * f}
                stroke="currentColor" className="text-gray-100 dark:text-gray-700" strokeWidth={1} />
            ))}
            {[0, 0.5, 1].map(f => (
              <text key={f} x={padL - 8} y={padT + plotH * (1 - f) + 3} textAnchor="end"
                className="fill-gray-400 dark:fill-gray-500" fontSize="9">
                {fmt0(maxBalance * f)}
              </text>
            ))}
            <path d={pathFor(compare.snowball.schedule)} fill="none" stroke={SNOWBALL_COLOR} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <path d={pathFor(compare.avalanche.schedule)} fill="none" stroke={AVALANCHE_COLOR} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            {hoverMonth !== null && (
              <>
                <line x1={x(hoverMonth)} x2={x(hoverMonth)} y1={padT} y2={padT + plotH}
                  stroke="currentColor" className="text-gray-300 dark:text-gray-600" strokeWidth={1} strokeDasharray="3,3" />
                <circle cx={x(hoverMonth)} cy={y(pointAt(compare.snowball.schedule, hoverMonth).total_balance)} r={3.5} fill={SNOWBALL_COLOR} />
                <circle cx={x(hoverMonth)} cy={y(pointAt(compare.avalanche.schedule, hoverMonth).total_balance)} r={3.5} fill={AVALANCHE_COLOR} />
              </>
            )}
          </svg>

          {hoverMonth !== null && (
            <div className="flex items-center justify-center gap-4 text-xs mb-2">
              <span className="text-gray-400 dark:text-gray-500">{fmtMonthYear(pointAt(compare.snowball.schedule, hoverMonth).date)}</span>
              <span style={{ color: SNOWBALL_COLOR }} className="font-semibold">{fmt(pointAt(compare.snowball.schedule, hoverMonth).total_balance)}</span>
              <span style={{ color: AVALANCHE_COLOR }} className="font-semibold">{fmt(pointAt(compare.avalanche.schedule, hoverMonth).total_balance)}</span>
            </div>
          )}

          <div className="flex items-center justify-end mt-2 mb-1">
            <div className="flex bg-gray-100 dark:bg-gray-900 rounded-lg p-0.5">
              <button onClick={() => setScheduleStrategy('snowball')}
                className={cn('text-xs px-2.5 py-1 rounded-md transition-colors font-medium', scheduleStrategy === 'snowball' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400')}>
                Snowball
              </button>
              <button onClick={() => setScheduleStrategy('avalanche')}
                className={cn('text-xs px-2.5 py-1 rounded-md transition-colors font-medium', scheduleStrategy === 'avalanche' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400')}>
                Avalanche
              </button>
            </div>
          </div>

          <PaymentSchedule plan={scheduleStrategy === 'snowball' ? compare.snowball : compare.avalanche} />

          <div className="flex items-center justify-between mt-4 mb-2 flex-wrap gap-2">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">Payoff Schedule</p>
            <div className="flex bg-gray-100 dark:bg-gray-900 rounded-lg p-0.5">
              <button onClick={() => setScheduleView('list')}
                className={cn('text-xs px-2.5 py-1 rounded-md transition-colors font-medium flex items-center gap-1', scheduleView === 'list' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400')}>
                List
              </button>
              <button onClick={() => setScheduleView('calendar')}
                className={cn('text-xs px-2.5 py-1 rounded-md transition-colors font-medium flex items-center gap-1', scheduleView === 'calendar' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400')}>
                <CalendarClock size={11} />Calendar
              </button>
            </div>
          </div>

          {scheduleView === 'list' ? (
            <div className="space-y-1.5">
              {[...(scheduleStrategy === 'snowball' ? compare.snowball : compare.avalanche).debts]
                .sort((a, b) => a.payoff_month - b.payoff_month)
                .map((d, i) => (
                  <div key={d.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-900 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-4 h-4 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 flex items-center justify-center text-[9px] font-bold text-gray-500 dark:text-gray-400 shrink-0">
                        {i + 1}
                      </span>
                      <span className="font-medium text-gray-700 dark:text-gray-300 truncate">{d.name}</span>
                      {d.budgeted_extra > 0 && (
                        <span className="text-[9px] font-medium px-1 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 shrink-0">
                          +{fmt0(d.budgeted_extra)} budgeted
                        </span>
                      )}
                    </div>
                    <span className="text-gray-500 dark:text-gray-400 shrink-0 ml-2">
                      {d.payoff_date ? fmtMonthYear(d.payoff_date) : `${d.payoff_month} mo`}
                    </span>
                  </div>
                ))}
            </div>
          ) : (
            <PayoffCalendar plan={scheduleStrategy === 'snowball' ? compare.snowball : compare.avalanche} />
          )}
        </>
      )}
    </div>
  )
}

function PayoffCalendar({ plan }: { plan: StrategyPlan }) {
  const byMonth = new Map<number, Required<PlanDebt>[]>()
  for (const d of plan.debts) {
    if (!byMonth.has(d.payoff_month)) byMonth.set(d.payoff_month, [])
    byMonth.get(d.payoff_month)!.push(d)
  }
  const milestoneMonths = [...byMonth.keys()].sort((a, b) => a - b)

  if (milestoneMonths.length === 0) {
    return <p className="text-xs text-gray-400 dark:text-gray-500">No debts to schedule.</p>
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {milestoneMonths.map(month => {
        const debtsThisMonth = byMonth.get(month)!
        const isLast = month === milestoneMonths[milestoneMonths.length - 1]
        return (
          <div key={month} className={cn(
            'rounded-xl border p-2.5',
            isLast ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900' : 'bg-gray-50 dark:bg-gray-900 border-gray-100 dark:border-gray-700'
          )}>
            <p className={cn('text-xs font-bold mb-1', isLast ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-700 dark:text-gray-300')}>
              {debtsThisMonth[0].payoff_date ? fmtMonthYear(debtsThisMonth[0].payoff_date) : `Month ${month}`}
            </p>
            <div className="space-y-0.5">
              {debtsThisMonth.map(d => (
                <p key={d.id} className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                  {isLast && '🎉 '}{d.name}
                </p>
              ))}
            </div>
            {isLast && <p className="text-[10px] text-emerald-600 dark:text-emerald-500 mt-1 font-medium">Debt-free!</p>}
          </div>
        )
      })}
    </div>
  )
}

const PAYMENT_SCHEDULE_VISIBLE_MONTHS = 12

function PaymentSchedule({ plan }: { plan: StrategyPlan }) {
  const [expanded, setExpanded] = useState(false)
  // One column per debt, in payoff order (matches the schedule/calendar
  // ordering below) — fixed across all rows so amounts line up like a
  // spreadsheet, even once a debt is paid off (its column just goes blank).
  const debtColumns = [...plan.debts].sort((a, b) => a.payoff_month - b.payoff_month)
  const months = plan.schedule.filter(m => m.month > 0)
  const visible = expanded ? months : months.slice(0, PAYMENT_SCHEDULE_VISIBLE_MONTHS)

  if (months.length === 0 || debtColumns.length === 0) {
    return null
  }

  return (
    <div className="mt-2">
      <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">Payment Schedule</p>

      {/* Per-debt summary — mirrors the classic debt-snowball-calculator layout */}
      <div className="border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden mb-3">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] border-collapse">
            <tbody>
              <tr className="bg-gray-50 dark:bg-gray-900">
                <td className="px-2.5 py-1.5 font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">Creditor</td>
                {debtColumns.map(d => (
                  <td key={d.id} className="text-right px-2.5 py-1.5 font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">{d.name}</td>
                ))}
              </tr>
              <tr className="border-t border-gray-50 dark:border-gray-800">
                <td className="px-2.5 py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">Balance</td>
                {debtColumns.map(d => (
                  <td key={d.id} className="text-right px-2.5 py-1.5 text-gray-700 dark:text-gray-300 tabular-nums whitespace-nowrap">{fmt(d.balance)}</td>
                ))}
              </tr>
              <tr className="border-t border-gray-50 dark:border-gray-800">
                <td className="px-2.5 py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">Rate</td>
                {debtColumns.map(d => (
                  <td key={d.id} className="text-right px-2.5 py-1.5 text-gray-700 dark:text-gray-300 tabular-nums whitespace-nowrap">{d.interest_rate.toFixed(2)}%</td>
                ))}
              </tr>
              <tr className="border-t border-gray-50 dark:border-gray-800">
                <td className="px-2.5 py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">Base Payment</td>
                {debtColumns.map(d => (
                  <td key={d.id} className="text-right px-2.5 py-1.5 text-gray-700 dark:text-gray-300 tabular-nums whitespace-nowrap">{fmt(d.minimum_payment)}</td>
                ))}
              </tr>
              <tr className="border-t border-gray-50 dark:border-gray-800">
                <td className="px-2.5 py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">Months to Pay Off</td>
                {debtColumns.map(d => (
                  <td key={d.id} className="text-right px-2.5 py-1.5 text-gray-700 dark:text-gray-300 tabular-nums whitespace-nowrap">{d.payoff_month}</td>
                ))}
              </tr>
              <tr className="border-t border-gray-50 dark:border-gray-800">
                <td className="px-2.5 py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">Month Paid Off</td>
                {debtColumns.map(d => (
                  <td key={d.id} className="text-right px-2.5 py-1.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">{d.payoff_date ? fmtMonthYear(d.payoff_date) : '—'}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-[11px] border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50 dark:bg-gray-900">
                <th className="text-left font-semibold text-gray-500 dark:text-gray-400 px-2.5 py-2 whitespace-nowrap">Month</th>
                {debtColumns.map(d => (
                  <th key={d.id} className="text-right font-semibold text-gray-500 dark:text-gray-400 px-2.5 py-2 whitespace-nowrap">
                    {d.name}
                  </th>
                ))}
                <th className="text-right font-semibold text-gray-700 dark:text-gray-300 px-2.5 py-2 whitespace-nowrap border-l border-gray-100 dark:border-gray-700">
                  Total Balance
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {visible.map(m => {
                const byDebtId = new Map(m.payments.map(p => [p.id, p]))
                return (
                  <tr key={m.month} className="hover:bg-gray-50 dark:hover:bg-gray-900/50">
                    <td className="px-2.5 py-1.5 text-gray-700 dark:text-gray-300 font-medium whitespace-nowrap">{fmtMonthYear(m.date)}</td>
                    {debtColumns.map(d => {
                      const p = byDebtId.get(d.id)
                      return (
                        <td key={d.id} className="text-right px-2.5 py-1.5 text-gray-600 dark:text-gray-400 whitespace-nowrap tabular-nums">
                          {p ? fmt(p.payment) : <span className="text-gray-300 dark:text-gray-600">—</span>}
                        </td>
                      )
                    })}
                    <td className="text-right px-2.5 py-1.5 font-semibold text-gray-900 dark:text-gray-100 whitespace-nowrap tabular-nums border-l border-gray-100 dark:border-gray-700">
                      {fmt(m.total_balance)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      {months.length > PAYMENT_SCHEDULE_VISIBLE_MONTHS && (
        <button onClick={() => setExpanded(v => !v)}
          className="text-xs text-blue-600 hover:text-blue-700 mt-2 font-medium">
          {expanded ? 'Show fewer months' : `Show all ${months.length} months`}
        </button>
      )}
    </div>
  )
}
