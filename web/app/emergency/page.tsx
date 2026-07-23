'use client'
import { useState, useEffect, useCallback } from 'react'
import { Shield, Plus, Minus, Loader2, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'
import { apiFetch } from '@/lib/api'

interface Goal {
  id: string
  name: string
  target_amount: number
  current_amount: number
  progress_pct: number
  icon: string
  color: string
  contributions: { id: string; amount: number; contributed_on: string; note: string | null }[]
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}
function fmt2(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

const BABY_STEPS = [
  { step: 1, label: '$1,000 Starter Emergency Fund', target: 1000, description: 'Your first mini emergency fund while paying off debt.' },
  { step: 3, label: '3–6 Months of Expenses', target: null, description: 'Full emergency fund after paying off all debt (Baby Step 2).' },
]

const today = new Date().toISOString().split('T')[0]

export default function EmergencyFundPage() {
  const [goal, setGoal] = useState<Goal | null>(null)
  const [loading, setLoading] = useState(true)
  const [monthlyExpenses, setMonthlyExpenses] = useState('')
  const [months, setMonths] = useState(3)
  const [amount, setAmount] = useState('')
  const [txDate, setTxDate] = useState(today)
  const [note, setNote] = useState('')
  const [isWithdraw, setIsWithdraw] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [editTarget, setEditTarget] = useState(false)
  const [newTarget, setNewTarget] = useState('')

  const fetchGoal = useCallback(async () => {
    setLoading(true)
    try {
      const goals = await apiFetch<Goal[]>('/api/v1/goals/')
      const ef = goals.find(g => g.name === 'Emergency Fund')
      setGoal(ef ?? null)
    } catch {} finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchGoal() }, [fetchGoal])

  const createFund = async () => {
    setSaving(true)
    try {
      const target = monthlyExpenses ? parseFloat(monthlyExpenses) * months : 1000
      const g = await apiFetch<Goal>('/api/v1/goals/', {
        method: 'POST',
        body: JSON.stringify({ name: 'Emergency Fund', target_amount: target, icon: '🛡️', color: 'blue' }),
      })
      setGoal(g)
    } catch {} finally { setSaving(false) }
  }

  const addTransaction = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!goal || !amount) return
    setSaving(true)
    try {
      const value = parseFloat(amount) * (isWithdraw ? -1 : 1)
      await apiFetch(`/api/v1/goals/${goal.id}/contributions`, {
        method: 'POST',
        body: JSON.stringify({ amount: value, contributed_on: txDate, note: note || null }),
      })
      setAmount('')
      setNote('')
      setTxDate(today)
      await fetchGoal()
    } catch {} finally { setSaving(false) }
  }

  const updateTarget = async () => {
    if (!goal || !newTarget) return
    setSaving(true)
    try {
      await apiFetch(`/api/v1/goals/${goal.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ target_amount: parseFloat(newTarget) }),
      })
      setEditTarget(false)
      setNewTarget('')
      await fetchGoal()
    } catch {} finally { setSaving(false) }
  }

  const computedTarget = monthlyExpenses ? parseFloat(monthlyExpenses) * months : null

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="animate-spin text-blue-600" size={32} />
    </div>
  )

  const pct = goal ? Math.min(100, (goal.current_amount / goal.target_amount) * 100) : 0
  const remaining = goal ? Math.max(0, goal.target_amount - goal.current_amount) : 0
  const isFullyFunded = goal ? goal.current_amount >= goal.target_amount : false

  // Determine which baby step
  const babyStep = goal && goal.current_amount >= 1000 ? 3 : 1

  return (
    <div>
      <PageHeader title="Emergency Fund" subtitle="Dave Ramsey Baby Steps 1 & 3" />

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">

        {!goal ? (
          /* Setup screen */
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-blue-50 dark:bg-blue-950/40 rounded-2xl flex items-center justify-center">
                <Shield size={24} className="text-blue-600" />
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">Set Up Your Emergency Fund</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">Dave Ramsey recommends 3–6 months of expenses</p>
              </div>
            </div>

            <div className="bg-blue-50 dark:bg-blue-950/40 rounded-xl p-4 space-y-1">
              <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wide">Baby Step 1</p>
              <p className="text-sm text-blue-900 dark:text-blue-200 font-medium">Save $1,000 as a starter emergency fund first</p>
              <p className="text-xs text-blue-700 dark:text-blue-400">Then tackle Baby Step 2 (debt payoff), then grow to 3–6 months.</p>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">Monthly Expenses (optional)</label>
              <input
                type="number" min="0" step="100" value={monthlyExpenses}
                onChange={e => setMonthlyExpenses(e.target.value)}
                placeholder="e.g. 3500"
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">We'll calculate your target automatically</p>
            </div>

            {monthlyExpenses && (
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2 block">Months of Expenses</label>
                <div className="flex gap-2">
                  {[1, 3, 6].map(m => (
                    <button key={m} onClick={() => setMonths(m)}
                      className={cn('flex-1 py-2 rounded-xl text-sm font-semibold border transition-colors',
                        months === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-blue-300')}>
                      {m} mo
                    </button>
                  ))}
                </div>
                {computedTarget && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    Target: <span className="font-bold text-gray-900 dark:text-gray-100">{fmt(computedTarget)}</span>
                  </p>
                )}
              </div>
            )}

            <button onClick={createFund} disabled={saving}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors text-sm">
              {saving ? 'Creating…' : `Start with ${computedTarget ? fmt(computedTarget) : '$1,000'} target`}
            </button>
          </div>
        ) : (
          <>
            {/* Progress card */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">🛡️</span>
                  <div>
                    <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">Emergency Fund</h2>
                    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full',
                      babyStep === 1 ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400' : 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400')}>
                      Baby Step {babyStep}
                    </span>
                  </div>
                </div>
                {isFullyFunded && (
                  <div className="flex items-center gap-1 text-green-600">
                    <CheckCircle2 size={18} />
                    <span className="text-xs font-semibold">Fully Funded!</span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3 mb-4">
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Saved</p>
                  <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{fmt(goal.current_amount)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Target</p>
                  <div className="flex items-center gap-1">
                    <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{fmt(goal.target_amount)}</p>
                    <button onClick={() => { setEditTarget(true); setNewTarget(String(goal.target_amount)) }}
                      className="text-gray-300 dark:text-gray-600 hover:text-blue-500 transition-colors text-xs">✏️</button>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Remaining</p>
                  <p className={cn('text-lg font-bold', isFullyFunded ? 'text-green-600' : 'text-gray-900 dark:text-gray-100')}>
                    {isFullyFunded ? '🎉 Done' : fmt(remaining)}
                  </p>
                </div>
              </div>

              {/* Progress bar */}
              <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden mb-1">
                <div
                  className={cn('h-full rounded-full transition-all duration-500',
                    isFullyFunded ? 'bg-green-500' : pct >= 75 ? 'bg-blue-500' : pct >= 40 ? 'bg-amber-400' : 'bg-red-400')}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500">{Math.round(pct)}% funded</p>

              {editTarget && (
                <div className="mt-4 flex gap-2">
                  <input type="number" value={newTarget} onChange={e => setNewTarget(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="New target" />
                  <button onClick={updateTarget} disabled={saving}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50">
                    Save
                  </button>
                  <button onClick={() => setEditTarget(false)}
                    className="px-3 py-2 text-gray-500 dark:text-gray-400 text-sm rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700">
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {/* Baby Steps guide */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4">
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">Dave Ramsey Baby Steps</p>
              <div className="space-y-2">
                {BABY_STEPS.map(s => {
                  const done = s.step === 1 ? goal.current_amount >= 1000 : goal.current_amount >= goal.target_amount
                  return (
                    <div key={s.step} className={cn('flex items-start gap-3 p-3 rounded-xl',
                      done ? 'bg-green-50 dark:bg-green-950/40' : s.step === babyStep ? 'bg-blue-50 dark:bg-blue-950/40' : 'bg-gray-50 dark:bg-gray-900')}>
                      <div className={cn('w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5',
                        done ? 'bg-green-500 text-white' : s.step === babyStep ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400')}>
                        {done ? '✓' : s.step}
                      </div>
                      <div>
                        <p className={cn('text-sm font-semibold', done ? 'text-green-800 dark:text-green-400' : 'text-gray-900 dark:text-gray-100')}>{s.label}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s.description}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Add / Withdraw */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-5">
              <div className="flex bg-gray-100 dark:bg-gray-900 rounded-xl p-1 mb-4">
                <button onClick={() => setIsWithdraw(false)}
                  className={cn('flex-1 py-2 text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5',
                    !isWithdraw ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400')}>
                  <Plus size={14} /> Add Money
                </button>
                <button onClick={() => setIsWithdraw(true)}
                  className={cn('flex-1 py-2 text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5',
                    isWithdraw ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400')}>
                  <Minus size={14} /> Withdraw
                </button>
              </div>
              <form onSubmit={addTransaction} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">Amount</label>
                    <input required type="number" min="0.01" step="0.01" value={amount}
                      onChange={e => setAmount(e.target.value)} placeholder="0.00"
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">Date</label>
                    <input required type="date" value={txDate} onChange={e => setTxDate(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">Note <span className="text-gray-400 dark:text-gray-500">(optional)</span></label>
                  <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Monthly transfer"
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <button type="submit" disabled={saving}
                  className={cn('w-full font-semibold py-3 rounded-xl transition-colors text-sm text-white disabled:opacity-50',
                    isWithdraw ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-600 hover:bg-blue-700')}>
                  {saving ? 'Saving…' : isWithdraw ? 'Record Withdrawal' : 'Add to Fund'}
                </button>
              </form>
            </div>

            {/* History */}
            {goal.contributions.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
                <button onClick={() => setShowHistory(h => !h)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Transaction History ({goal.contributions.length})</p>
                  {showHistory ? <ChevronUp size={16} className="text-gray-400 dark:text-gray-500" /> : <ChevronDown size={16} className="text-gray-400 dark:text-gray-500" />}
                </button>
                {showHistory && (
                  <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                    {[...goal.contributions].reverse().map(c => (
                      <li key={c.id} className="flex items-center justify-between px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-gray-800 dark:text-gray-300">{c.note || (c.amount < 0 ? 'Withdrawal' : 'Deposit')}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500">{c.contributed_on}</p>
                        </div>
                        <span className={cn('text-sm font-bold', c.amount < 0 ? 'text-red-500' : 'text-green-600')}>
                          {c.amount < 0 ? '-' : '+'}{fmt2(Math.abs(c.amount))}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
