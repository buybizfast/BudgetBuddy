'use client'
import { useState, useEffect, useCallback } from 'react'
import { Target, Plus, Trash2, Loader2, DollarSign } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001'

interface Goal {
  id: string
  name: string
  target_amount: number
  current_amount: number
  target_date: string | null
  icon: string
  color: string
}

const EMOJIS = ['🎯', '🏠', '🚗', '✈️', '📚', '💍', '🏖️', '💰']
const COLORS = ['#16a34a', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#f97316']

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

function fmt2(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function monthsLeft(target: string | null) {
  if (!target) return null
  const diff = new Date(target).getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24 * 30)))
}

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', target_amount: '', current_amount: '', target_date: '', emoji: '🎯', color: '#16a34a' })
  const [addingGoal, setAddingGoal] = useState(false)
  const [fundInputs, setFundInputs] = useState<Record<string, string>>({})
  const [fundingId, setFundingId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchGoals = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${BASE}/api/v1/goals/`)
      setGoals(await res.json())
    } catch { setGoals([]) } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchGoals() }, [fetchGoals])

  const addGoal = async () => {
    if (!addForm.name || !addForm.target_amount) return
    setAddingGoal(true)
    try {
      await fetch(`${BASE}/api/v1/goals/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: addForm.name,
          target_amount: parseFloat(addForm.target_amount),
          target_date: addForm.target_date || null,
          icon: addForm.emoji,
          color: addForm.color
        })
      })
      await fetchGoals()
      setAddForm({ name: '', target_amount: '', current_amount: '', target_date: '', emoji: '🎯', color: '#16a34a' })
      setShowAdd(false)
    } catch {} finally { setAddingGoal(false) }
  }

  const addFunds = async (goalId: string) => {
    const amount = parseFloat(fundInputs[goalId] || '0')
    if (!amount) return
    setFundingId(goalId)
    try {
      await fetch(`${BASE}/api/v1/goals/${goalId}/contributions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, contributed_on: new Date().toISOString().slice(0, 10), note: null })
      })
      await fetchGoals()
      setFundInputs(f => ({ ...f, [goalId]: '' }))
    } catch {} finally { setFundingId(null) }
  }

  const deleteGoal = async (id: string) => {
    setDeletingId(id)
    try {
      await fetch(`${BASE}/api/v1/goals/${id}`, { method: 'DELETE' })
      await fetchGoals()
    } catch {} finally { setDeletingId(null); setConfirmDelete(null) }
  }

  const totalSaved = goals.reduce((s, g) => s + g.current_amount, 0)
  const totalTargets = goals.reduce((s, g) => s + g.target_amount, 0)
  const completed = goals.filter(g => g.current_amount >= g.target_amount).length

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="animate-spin text-blue-600" size={32} />
    </div>
  )

  return (
    <div>
      <PageHeader
        title="Savings Goals"
        right={
          <button onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-1.5 text-xs px-3 py-2 bg-[#1a2e4a] hover:bg-[#162540] rounded-2xl text-white transition-colors font-semibold">
            <Plus size={12} />New Goal
          </button>
        }
      />
      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <p className="text-xs text-gray-500 mb-1">Total Saved</p>
          <p className="text-xl font-bold text-blue-600">{fmt(totalSaved)}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <p className="text-xs text-gray-500 mb-1">Total Targets</p>
          <p className="text-xl font-bold text-gray-900">{fmt(totalTargets)}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <p className="text-xs text-gray-500 mb-1">Completed</p>
          <p className="text-xl font-bold text-blue-600">{completed} / {goals.length}</p>
        </div>
      </div>

      {showAdd && (
        <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-900">Create New Goal</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-gray-500 mb-1 block font-medium">Goal Name *</label>
              <input value={addForm.name} onChange={e => setAddForm(f => ({...f, name: e.target.value}))}
                placeholder="e.g. Emergency Fund"
                className="w-full bg-white text-gray-900 text-sm rounded-xl px-3 py-2 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block font-medium">Target Amount *</label>
              <input type="number" value={addForm.target_amount} onChange={e => setAddForm(f => ({...f, target_amount: e.target.value}))}
                placeholder="0.00"
                className="w-full bg-white text-gray-900 text-sm rounded-xl px-3 py-2 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block font-medium">Current Amount</label>
              <input type="number" value={addForm.current_amount} onChange={e => setAddForm(f => ({...f, current_amount: e.target.value}))}
                placeholder="0.00"
                className="w-full bg-white text-gray-900 text-sm rounded-xl px-3 py-2 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block font-medium">Target Date</label>
              <input type="date" value={addForm.target_date} onChange={e => setAddForm(f => ({...f, target_date: e.target.value}))}
                className="w-full bg-white text-gray-900 text-sm rounded-xl px-3 py-2 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block font-medium">Icon</label>
              <div className="flex gap-1.5 flex-wrap">
                {EMOJIS.map(e => (
                  <button key={e} onClick={() => setAddForm(f => ({...f, emoji: e}))}
                    className={cn('text-lg w-8 h-8 rounded-lg flex items-center justify-center transition-colors border', addForm.emoji === e ? 'bg-blue-50 border-blue-400 ring-1 ring-blue-500' : 'bg-gray-50 border-gray-200 hover:bg-gray-100')}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block font-medium">Color</label>
              <div className="flex gap-1.5 flex-wrap">
                {COLORS.map(c => (
                  <button key={c} onClick={() => setAddForm(f => ({...f, color: c}))}
                    className={cn('w-6 h-6 rounded-full transition-transform', addForm.color === c ? 'scale-125 ring-2 ring-gray-400 ring-offset-1' : 'hover:scale-110')}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={addGoal} disabled={addingGoal}
              className="text-sm px-4 py-2 bg-[#1a2e4a] hover:bg-[#162540] text-white rounded-2xl transition-colors disabled:opacity-50 flex items-center gap-1.5 font-semibold">
              {addingGoal ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Create Goal
            </button>
            <button onClick={() => setShowAdd(false)} className="text-sm px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {goals.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm p-12 text-center">
          <Target size={40} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-600 font-medium">No goals yet</p>
          <p className="text-sm text-gray-400 mt-1">Create a savings goal to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {goals.map(goal => {
            const pct = goal.target_amount > 0 ? Math.min(100, (goal.current_amount / goal.target_amount) * 100) : 0
            const isCompleted = goal.current_amount >= goal.target_amount
            const ml = monthsLeft(goal.target_date)
            const monthlyNeeded = ml && ml > 0 && !isCompleted
              ? (goal.target_amount - goal.current_amount) / ml
              : null
            const circumference = 2 * Math.PI * 30
            const dashOffset = circumference - (pct / 100) * circumference

            return (
              <div key={goal.id} className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0"
                      style={{ backgroundColor: goal.color + '20', border: `1.5px solid ${goal.color}40` }}>
                      {goal.icon}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900 leading-tight">{goal.name}</p>
                      {isCompleted && <span className="text-xs text-blue-600 font-medium">Completed!</span>}
                    </div>
                  </div>
                  <div className="relative shrink-0">
                    <svg width="52" height="52" viewBox="0 0 68 68">
                      <circle cx="34" cy="34" r="30" fill="none" stroke="#f1f5f9" strokeWidth="6" />
                      <circle cx="34" cy="34" r="30" fill="none" stroke={goal.color} strokeWidth="6"
                        strokeDasharray={circumference} strokeDashoffset={dashOffset}
                        strokeLinecap="round" transform="rotate(-90 34 34)" />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-gray-700">
                      {Math.round(pct)}%
                    </span>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-gray-600">{fmt2(goal.current_amount)} saved</span>
                    <span className="text-gray-400">of {fmt(goal.target_amount)}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: goal.color }} />
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {goal.target_date && (
                    <span className="text-xs px-2 py-0.5 bg-gray-100 rounded-full text-gray-500">
                      {new Date(goal.target_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                    </span>
                  )}
                  {ml !== null && !isCompleted && (
                    <span className="text-xs px-2 py-0.5 bg-gray-100 rounded-full text-gray-500">
                      {ml} mo left
                    </span>
                  )}
                  {monthlyNeeded !== null && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: goal.color + '15', color: goal.color }}>
                      {fmt2(monthlyNeeded)}/mo needed
                    </span>
                  )}
                </div>

                {!isCompleted && (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 flex-1">
                      <DollarSign size={11} className="text-gray-400 shrink-0" />
                      <input type="number" placeholder="Add funds…" value={fundInputs[goal.id] || ''}
                        onChange={e => setFundInputs(f => ({...f, [goal.id]: e.target.value}))}
                        className="bg-white text-gray-900 text-xs rounded-xl px-2 py-1.5 flex-1 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <button onClick={() => addFunds(goal.id)} disabled={fundingId === goal.id || !fundInputs[goal.id]}
                      className="text-xs px-2.5 py-1.5 bg-[#1a2e4a] hover:bg-[#162540] rounded-2xl transition-colors disabled:opacity-50 text-white font-semibold">
                      {fundingId === goal.id ? <Loader2 size={10} className="animate-spin" /> : 'Add'}
                    </button>
                  </div>
                )}

                <div className="pt-1 border-t border-gray-100">
                  {confirmDelete === goal.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">Delete this goal?</span>
                      <button onClick={() => deleteGoal(goal.id)} disabled={deletingId === goal.id}
                        className="text-xs px-2 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded transition-colors">
                        {deletingId === goal.id ? <Loader2 size={10} className="animate-spin inline" /> : 'Delete'}
                      </button>
                      <button onClick={() => setConfirmDelete(null)} className="text-xs px-2 py-0.5 bg-white border border-gray-200 text-gray-700 rounded-xl transition-colors">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDelete(goal.id)}
                      className="text-xs text-gray-400 hover:text-red-500 transition-colors flex items-center gap-1">
                      <Trash2 size={11} />Delete goal
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
      </div>
    </div>
  )
}
