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

interface PlanDebt { id: string; name: string; balance: number; minimum_payment: number; interest_rate: number; payoff_month: number; budgeted_extra: number }

interface PayoffPlan { debts: PlanDebt[]; total_months: number; total_interest: number; strategy: string; total_budgeted_extra: number }

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export default function DebtPage() {
  const [debts, setDebts] = useState<Debt[]>([])
  const [loading, setLoading] = useState(true)
  const [plan, setPlan] = useState<PayoffPlan | null>(null)
  const [strategy, setStrategy] = useState<'snowball' | 'avalanche'>('snowball')
  const [extraMonthly, setExtraMonthly] = useState('0')
  const [calcLoading, setCalcLoading] = useState(false)
  const [expandedDebt, setExpandedDebt] = useState<string | null>(null)
  const [paymentInputs, setPaymentInputs] = useState<Record<string, { amount: string; note: string }>>({})
  const [payingId, setPayingId] = useState<string | null>(null)
  const [detailsModalDebt, setDetailsModalDebt] = useState<Debt | null>(null)
  const [savingDetailsId, setSavingDetailsId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState({
    name: '', balance: '', interest_rate: '', minimum_payment: '',
    account_type: 'loan', due_date_day: '', statement_date_day: '', total_installments: '',
  })
  const [addingDebt, setAddingDebt] = useState(false)

  const fetchDebts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch<any[]>(`/api/v1/debt/`)
      setDebts(res)
    } catch { setDebts([]) } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchDebts() }, [fetchDebts])

  const calcPlan = async () => {
    setCalcLoading(true)
    try {
      const res = await apiFetch<any>(`/api/v1/debt/plan?strategy=${strategy}&extra_monthly=${parseFloat(extraMonthly) || 0}`)
      setPlan(res)
    } catch {} finally { setCalcLoading(false) }
  }

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
    account_type: string; minimum_payment: string; interest_rate: string; original_balance: string
  }) => {
    setSavingDetailsId(debtId)
    try {
      await apiFetch(`/api/v1/debt/${debtId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_type: details.account_type,
          minimum_payment: details.minimum_payment !== '' ? parseFloat(details.minimum_payment) : null,
          interest_rate: details.interest_rate !== '' ? parseFloat(details.interest_rate) : null,
          original_balance: details.original_balance !== '' ? parseFloat(details.original_balance) : null,
        })
      })
      await fetchDebts()
      setDetailsModalDebt(null)
    } catch {} finally { setSavingDetailsId(null) }
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
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

        {/* Payoff Plan Sidebar */}
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4">
            <div className="flex items-center gap-2 mb-4">
              <Calculator size={14} className="text-blue-600" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Payoff Plan</h3>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1.5 block font-medium">Strategy</label>
                <div className="flex bg-gray-100 dark:bg-gray-900 rounded-lg p-0.5">
                  <button onClick={() => setStrategy('snowball')} className={cn('flex-1 text-xs py-1.5 rounded-md transition-colors font-medium', strategy === 'snowball' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200')}>
                    Snowball
                  </button>
                  <button onClick={() => setStrategy('avalanche')} className={cn('flex-1 text-xs py-1.5 rounded-md transition-colors font-medium', strategy === 'avalanche' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200')}>
                    Avalanche
                  </button>
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
                  {strategy === 'snowball' ? 'Pay smallest balance first for quick wins' : 'Pay highest interest first to save money'}
                </p>
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block font-medium">Extra Monthly Payment</label>
                <div className="flex items-center gap-1">
                  <span className="text-gray-400 dark:text-gray-500 text-sm">$</span>
                  <input type="number" value={extraMonthly} onChange={e => setExtraMonthly(e.target.value)}
                    className="flex-1 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm rounded-xl px-2 py-1.5 border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <button onClick={calcPlan} disabled={calcLoading}
                className="w-full text-sm py-2 bg-[#1a2e4a] hover:bg-[#162540] text-white rounded-2xl transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5 font-semibold">
                {calcLoading ? <Loader2 size={12} className="animate-spin" /> : <Calculator size={12} />}
                Calculate Plan
              </button>
            </div>

            {plan && (
              <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 space-y-3">
                {plan.total_budgeted_extra > 0 && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <DollarSign size={11} />Includes {fmt(plan.total_budgeted_extra)}/mo already budgeted above minimums
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-slate-50 dark:bg-gray-900 rounded-lg p-3 border border-gray-100 dark:border-gray-700">
                    <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Debt Free In</p>
                    <p className="text-base font-bold text-gray-900 dark:text-gray-100">{plan.total_months} mo</p>
                  </div>
                  <div className="bg-slate-50 dark:bg-gray-900 rounded-lg p-3 border border-gray-100 dark:border-gray-700">
                    <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Total Interest</p>
                    <p className="text-base font-bold text-red-500">{fmt(plan.total_interest)}</p>
                  </div>
                </div>
                {plan.debts.length > 0 && (
                  <div className="bg-slate-50 dark:bg-gray-900 rounded-lg p-3 border border-gray-100 dark:border-gray-700">
                    <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">First Payoff</p>
                    <p className="text-sm font-semibold text-blue-600">
                      {plan.debts.reduce((a, b) => a.payoff_month <= b.payoff_month ? a : b).name}
                      {' '}({Math.min(...plan.debts.map(d => d.payoff_month))} mo)
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
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
  onSave: (details: { account_type: string; minimum_payment: string; interest_rate: string; original_balance: string }) => void
  onClose: () => void
}) {
  const [accountType, setAccountType] = useState(debt.account_type)
  const [minimumPayment, setMinimumPayment] = useState(String(debt.minimum_payment))
  const [interestRate, setInterestRate] = useState(String(debt.interest_rate))
  const [originalBalance, setOriginalBalance] = useState(String(debt.original_balance))

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

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onSave({ account_type: accountType, minimum_payment: minimumPayment, interest_rate: interestRate, original_balance: originalBalance })}
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
