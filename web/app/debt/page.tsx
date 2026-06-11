'use client'
import { useState, useEffect, useCallback } from 'react'
import { CreditCard, Plus, Trash2, ChevronDown, ChevronUp, Loader2, Calculator, DollarSign } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001'

interface Debt {
  id: string; name: string; balance: number; total_paid: number
  interest_rate: number; minimum_payment: number; payments: Payment[]
}

interface Payment { id: string; amount: number; paid_on: string; note: string | null }

interface PlanDebt { id: string; name: string; balance: number; minimum_payment: number; interest_rate: number; payoff_month: number }

interface PayoffPlan { debts: PlanDebt[]; total_months: number; total_interest: number; strategy: string }

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
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', balance: '', interest_rate: '', minimum_payment: '' })
  const [addingDebt, setAddingDebt] = useState(false)

  const fetchDebts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${BASE}/api/v1/debt/`)
      setDebts(await res.json())
    } catch { setDebts([]) } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchDebts() }, [fetchDebts])

  const calcPlan = async () => {
    setCalcLoading(true)
    try {
      const res = await fetch(`${BASE}/api/v1/debt/plan?strategy=${strategy}&extra_monthly=${parseFloat(extraMonthly) || 0}`)
      setPlan(await res.json())
    } catch {} finally { setCalcLoading(false) }
  }

  const logPayment = async (debtId: string) => {
    const inp = paymentInputs[debtId]
    if (!inp?.amount) return
    setPayingId(debtId)
    try {
      await fetch(`${BASE}/api/v1/debt/${debtId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: parseFloat(inp.amount), paid_on: new Date().toISOString().slice(0, 10), note: inp.note || null })
      })
      await fetchDebts()
      setPaymentInputs(p => ({ ...p, [debtId]: { amount: '', note: '' } }))
    } catch {} finally { setPayingId(null) }
  }

  const deleteDebt = async (id: string) => {
    setDeletingId(id)
    try {
      await fetch(`${BASE}/api/v1/debt/${id}`, { method: 'DELETE' })
      await fetchDebts()
    } catch {} finally { setDeletingId(null); setConfirmDelete(null) }
  }

  const addDebt = async () => {
    if (!addForm.name || !addForm.balance) return
    setAddingDebt(true)
    try {
      await fetch(`${BASE}/api/v1/debt/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: addForm.name,
          balance: parseFloat(addForm.balance),
          interest_rate: parseFloat(addForm.interest_rate || '0'),
          minimum_payment: parseFloat(addForm.minimum_payment || '0')
        })
      })
      await fetchDebts()
      setAddForm({ name: '', balance: '', interest_rate: '', minimum_payment: '' })
      setShowAddForm(false)
    } catch {} finally { setAddingDebt(false) }
  }

  const totalBalance = debts.reduce((s, d) => s + d.balance, 0)
  const totalPaid = debts.reduce((s, d) => s + d.total_paid, 0)
  const totalOriginal = totalBalance + totalPaid

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="animate-spin text-blue-600" size={32} />
    </div>
  )

  return (
    <div>
      <PageHeader
        title="Debt Snowball"
        right={
          <button onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-1.5 text-xs px-3 py-2 bg-[#1a2e4a] hover:bg-[#162540] rounded-2xl text-white transition-colors font-semibold">
            <Plus size={12} />Add Debt
          </button>
        }
      />
      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <p className="text-xs text-gray-500 mb-1">Total Remaining</p>
          <p className="text-xl font-bold text-red-500">{fmt(totalBalance)}</p>
          <p className="text-xs text-gray-400 mt-1">{debts.length} debts</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <p className="text-xs text-gray-500 mb-1">Total Paid</p>
          <p className="text-xl font-bold text-blue-600">{fmt(Math.max(0, totalPaid))}</p>
          <p className="text-xs text-gray-400 mt-1">of {fmt(totalOriginal)}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <p className="text-xs text-gray-500 mb-1">Progress</p>
          <p className="text-xl font-bold text-gray-900">
            {totalOriginal > 0 ? Math.round((totalPaid / totalOriginal) * 100) : 0}%
          </p>
          <div className="h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all"
              style={{ width: `${totalOriginal > 0 ? Math.min(100, (totalPaid / totalOriginal) * 100) : 0}%` }} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          {showAddForm && (
            <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-900">Add New Debt</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs text-gray-500 mb-1 block font-medium">Debt Name *</label>
                  <input value={addForm.name} onChange={e => setAddForm(f => ({...f, name: e.target.value}))}
                    placeholder="e.g. Chase Credit Card"
                    className="w-full bg-white text-gray-900 text-sm rounded-xl px-3 py-2 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block font-medium">Current Balance *</label>
                  <input type="number" value={addForm.balance} onChange={e => setAddForm(f => ({...f, balance: e.target.value}))}
                    placeholder="0.00"
                    className="w-full bg-white text-gray-900 text-sm rounded-xl px-3 py-2 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block font-medium">Interest Rate (%)</label>
                  <input type="number" value={addForm.interest_rate} onChange={e => setAddForm(f => ({...f, interest_rate: e.target.value}))}
                    placeholder="0.00"
                    className="w-full bg-white text-gray-900 text-sm rounded-xl px-3 py-2 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block font-medium">Minimum Payment</label>
                  <input type="number" value={addForm.minimum_payment} onChange={e => setAddForm(f => ({...f, minimum_payment: e.target.value}))}
                    placeholder="0.00"
                    className="w-full bg-white text-gray-900 text-sm rounded-xl px-3 py-2 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={addDebt} disabled={addingDebt}
                  className="text-sm px-4 py-2 bg-[#1a2e4a] hover:bg-[#162540] text-white rounded-2xl transition-colors disabled:opacity-50 flex items-center gap-1.5 font-semibold">
                  {addingDebt ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  Add Debt
                </button>
                <button onClick={() => setShowAddForm(false)} className="text-sm px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {debts.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm p-12 text-center">
              <CreditCard size={40} className="text-gray-300 mx-auto mb-3" />
              <p className="text-gray-600 font-medium">No debts added</p>
              <p className="text-sm text-gray-400 mt-1">Add your debts to start your payoff plan.</p>
            </div>
          ) : (
            debts.map(debt => {
              const originalBalance = debt.balance + debt.total_paid
              const paid = debt.total_paid
              const pct = originalBalance > 0 ? Math.min(100, (paid / originalBalance) * 100) : 0
              const expanded = expandedDebt === debt.id
              const inp = paymentInputs[debt.id] || { amount: '', note: '' }

              return (
                <div key={debt.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3.5 cursor-pointer hover:bg-slate-50 transition-colors"
                    onClick={() => setExpandedDebt(expanded ? null : debt.id)}>
                    <div className="flex items-center gap-3">
                      <CreditCard size={15} className="text-red-400 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{debt.name}</p>
                        <p className="text-xs text-gray-400">
                          {debt.interest_rate > 0 ? `${debt.interest_rate}% APR · ` : ''}
                          Min. payment: {fmt(debt.minimum_payment)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-sm font-bold text-red-500">{fmt(debt.balance)}</p>
                        <p className="text-xs text-gray-400">{Math.round(pct)}% paid off</p>
                      </div>
                      {expanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                    </div>
                  </div>

                  <div className="h-1 bg-gray-100 mx-4">
                    <div className="h-full bg-blue-500 transition-all rounded-full" style={{ width: `${pct}%` }} />
                  </div>

                  {expanded && (
                    <div className="px-4 py-3 space-y-3 border-t border-gray-100 mt-1">
                      <div>
                        <p className="text-xs text-gray-500 font-medium mb-2 flex items-center gap-1">
                          <DollarSign size={11} />Log Payment
                        </p>
                        <div className="flex items-center gap-2">
                          <input type="number" value={inp.amount} placeholder="Amount"
                            onChange={e => setPaymentInputs(p => ({ ...p, [debt.id]: { ...inp, amount: e.target.value } }))}
                            className="bg-white text-gray-900 text-xs rounded-xl px-2 py-1.5 w-28 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                          <input value={inp.note} placeholder="Note (optional)"
                            onChange={e => setPaymentInputs(p => ({ ...p, [debt.id]: { ...inp, note: e.target.value } }))}
                            className="bg-white text-gray-900 text-xs rounded-xl px-2 py-1.5 flex-1 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                          <button onClick={() => logPayment(debt.id)} disabled={payingId === debt.id || !inp.amount}
                            className="text-xs px-3 py-1.5 bg-[#1a2e4a] hover:bg-[#162540] text-white rounded-2xl transition-colors disabled:opacity-50 flex items-center gap-1 font-semibold">
                            {payingId === debt.id ? <Loader2 size={10} className="animate-spin" /> : null}
                            Log
                          </button>
                        </div>
                      </div>

                      {debt.payments.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-500 font-medium mb-2">Payment History</p>
                          <div className="space-y-1.5">
                            {debt.payments.slice(0, 5).map(p => (
                              <div key={p.id} className="flex justify-between text-xs">
                                <span className="text-gray-400">{p.paid_on} {p.note && <span className="text-gray-300">— {p.note}</span>}</span>
                                <span className="text-blue-600 font-medium">{fmt(p.amount)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="pt-1 border-t border-gray-100">
                        {confirmDelete === debt.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">Delete {debt.name}?</span>
                            <button onClick={() => deleteDebt(debt.id)} disabled={deletingId === debt.id}
                              className="text-xs px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded transition-colors disabled:opacity-50">
                              {deletingId === debt.id ? <Loader2 size={10} className="animate-spin inline" /> : 'Delete'}
                            </button>
                            <button onClick={() => setConfirmDelete(null)} className="text-xs px-2 py-1 bg-white border border-gray-200 text-gray-700 rounded-xl transition-colors">
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmDelete(debt.id)}
                            className="text-xs text-gray-400 hover:text-red-500 transition-colors flex items-center gap-1">
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
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <div className="flex items-center gap-2 mb-4">
              <Calculator size={14} className="text-blue-600" />
              <h3 className="text-sm font-semibold text-gray-900">Payoff Plan</h3>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 mb-1.5 block font-medium">Strategy</label>
                <div className="flex bg-gray-100 rounded-lg p-0.5">
                  <button onClick={() => setStrategy('snowball')} className={cn('flex-1 text-xs py-1.5 rounded-md transition-colors font-medium', strategy === 'snowball' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
                    Snowball
                  </button>
                  <button onClick={() => setStrategy('avalanche')} className={cn('flex-1 text-xs py-1.5 rounded-md transition-colors font-medium', strategy === 'avalanche' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
                    Avalanche
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1.5">
                  {strategy === 'snowball' ? 'Pay smallest balance first for quick wins' : 'Pay highest interest first to save money'}
                </p>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block font-medium">Extra Monthly Payment</label>
                <div className="flex items-center gap-1">
                  <span className="text-gray-400 text-sm">$</span>
                  <input type="number" value={extraMonthly} onChange={e => setExtraMonthly(e.target.value)}
                    className="flex-1 bg-white text-gray-900 text-sm rounded-xl px-2 py-1.5 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <button onClick={calcPlan} disabled={calcLoading}
                className="w-full text-sm py-2 bg-[#1a2e4a] hover:bg-[#162540] text-white rounded-2xl transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5 font-semibold">
                {calcLoading ? <Loader2 size={12} className="animate-spin" /> : <Calculator size={12} />}
                Calculate Plan
              </button>
            </div>

            {plan && (
              <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-slate-50 rounded-lg p-3 border border-gray-100">
                    <p className="text-xs text-gray-400 mb-0.5">Debt Free In</p>
                    <p className="text-base font-bold text-gray-900">{plan.total_months} mo</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3 border border-gray-100">
                    <p className="text-xs text-gray-400 mb-0.5">Total Interest</p>
                    <p className="text-base font-bold text-red-500">{fmt(plan.total_interest)}</p>
                  </div>
                </div>
                {plan.debts.length > 0 && (
                  <div className="bg-slate-50 rounded-lg p-3 border border-gray-100">
                    <p className="text-xs text-gray-400 mb-0.5">First Payoff</p>
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
    </div>
  )
}
