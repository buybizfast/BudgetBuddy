'use client'
import { useState, useEffect } from 'react'
import {
  ChevronLeft, ChevronRight, RefreshCw, Wand2, Copy,
  TrendingUp, Sparkles, Repeat2, Loader2, Plus, ChevronDown, X, Bell,
} from 'lucide-react'
import { useBudget, BudgetGroup, BudgetCategory } from '@/hooks/useBudget'
import { PageHeader } from '@/components/PageHeader'
import { PaycheckCard } from '@/components/PaycheckCard'
import { cn } from '@/lib/utils'

import { apiFetch } from '@/lib/api'
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

function fmt2(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

interface Toast { id: number; message: string }
interface SpendingAlert { id: string; category_id: string; threshold_pct: number; enabled: boolean }
interface TriggeredAlert { alert_id: string; category_id: string; category_name: string; threshold_pct: number; budgeted: number; spent: number; pct_used: number; triggered: boolean }

export default function BudgetPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const { budget, loading, error, updateIncome, updateCategory, renameCategory, addCategory, syncStatus, syncNow, autoCategorize, recentTransactions } = useBudget(year, month)
  const [editingIncome, setEditingIncome] = useState(false)
  const [incomeInput, setIncomeInput] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [alerts, setAlerts] = useState<SpendingAlert[]>([])
  const [triggeredAlerts, setTriggeredAlerts] = useState<TriggeredAlert[]>([])
  const [editingCategory, setEditingCategory] = useState<string | null>(null)
  const [categoryInput, setCategoryInput] = useState('')
  const [addingCategoryGroup, setAddingCategoryGroup] = useState<string | null>(null)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [toasts, setToasts] = useState<Toast[]>([])
  const [insights, setInsights] = useState<string | null>(null)
  const [loadingInsights, setLoadingInsights] = useState(false)
  const [recurring, setRecurring] = useState<any[]>([])
  const [loadingRecurring, setLoadingRecurring] = useState(false)
  const [copyingMonth, setCopyingMonth] = useState(false)

  const navMonth = (dir: number) => {
    let m = month + dir, y = year
    if (m < 1) { m = 12; y-- }
    if (m > 12) { m = 1; y++ }
    setMonth(m); setYear(y)
  }

  useEffect(() => {
    if (!budget) return
    const over = budget.groups.flatMap(g => g.categories).filter(c => c.spent > c.budgeted && c.budgeted > 0)
    if (over.length > 0) {
      const id = Date.now()
      setToasts(t => [...t, { id, message: `${over[0].name} is over budget by ${fmt(over[0].spent - over[0].budgeted)}` }])
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5000)
    }
  }, [budget?.id])

  const fetchInsights = async () => {
    setLoadingInsights(true)
    try {
      const data = await apiFetch<any>(`/api/v1/budget/insights/${year}/${month}`)
      setInsights(data.insights || data.message || JSON.stringify(data))
    } catch { setInsights('Unable to load insights at this time.') }
    finally { setLoadingInsights(false) }
  }

  const fetchRecurring = async () => {
    setLoadingRecurring(true)
    try {
      const data = await apiFetch<any[]>(`/api/v1/budget/recurring`)
      setRecurring(data)
    } catch { setRecurring([]) }
    finally { setLoadingRecurring(false) }
  }

  useEffect(() => { fetchRecurring() }, [])

  const fetchAlerts = async () => {
    try {
      const [alertsRes, checkRes] = await Promise.all([
        apiFetch<any[]>(`/api/v1/alerts/`).catch(() => null),
        apiFetch<any[]>(`/api/v1/alerts/check/${year}/${month}`).catch(() => null),
      ])
      if (alertsRes) setAlerts(alertsRes)
      if (checkRes) setTriggeredAlerts(checkRes)
    } catch {}
  }

  useEffect(() => { fetchAlerts() }, [year, month, budget?.id])

  const upsertAlert = async (categoryId: string, threshold: number) => {
    const existing = alerts.find(a => a.category_id === categoryId)
    if (existing) {
      await apiFetch(`/api/v1/alerts/${existing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threshold_pct: threshold, enabled: true })
      })
    } else {
      await apiFetch(`/api/v1/alerts/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_id: categoryId, threshold_pct: threshold })
      })
    }
    await fetchAlerts()
  }

  const deleteAlert = async (categoryId: string) => {
    const existing = alerts.find(a => a.category_id === categoryId)
    if (existing) {
      await apiFetch(`/api/v1/alerts/${existing.id}`, { method: 'DELETE' })
      await fetchAlerts()
    }
  }

  const copyLastMonth = async () => {
    setCopyingMonth(true)
    try {
      await apiFetch(`/api/v1/budget/month/${year}/${month}/copy-previous`, { method: 'POST' })
      window.location.reload()
    } catch {} finally { setCopyingMonth(false) }
  }

  const saveIncome = async () => {
    const n = parseFloat(incomeInput.replace(/[^0-9.]/g, ''))
    if (!isNaN(n)) await updateIncome(n)
    setEditingIncome(false)
  }

  const saveCategory = async (id: string) => {
    const n = parseFloat(categoryInput.replace(/[^0-9.]/g, ''))
    if (!isNaN(n)) await updateCategory(id, n)
    setEditingCategory(null)
  }

  const submitAddCategory = async (groupId: string) => {
    if (!newCategoryName.trim()) return
    await addCategory(groupId, newCategoryName.trim())
    setNewCategoryName(''); setAddingCategoryGroup(null)
  }

  const toggleGroup = (id: string) => setCollapsedGroups(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="animate-spin text-blue-600" size={32} />
    </div>
  )

  const leftToBudget = budget?.left_to_budget ?? 0
  const isZero = leftToBudget === 0
  const isOver = leftToBudget < 0
  const isEmpty = !budget || budget.groups.length === 0

  const headerRight = (
    <div className="flex items-center gap-2">
      <button onClick={() => navMonth(-1)} aria-label="Previous month" className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-colors">
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <button onClick={() => navMonth(1)} aria-label="Next month" className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-colors">
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </div>
  )

  return (
    <div>
      <PageHeader
        title={`${MONTHS[month - 1]} ${year}`}
        right={headerRight}
      />

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={syncNow} disabled={syncStatus.syncing}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl transition-colors disabled:opacity-50 shadow-sm">
            {syncStatus.syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {syncStatus.syncing ? 'Syncing…' : 'Sync'}
          </button>
          <button onClick={autoCategorize}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl transition-colors shadow-sm">
            <Wand2 size={12} />Auto-Assign
          </button>
          <button onClick={copyLastMonth} disabled={copyingMonth}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl transition-colors disabled:opacity-50 shadow-sm">
            {copyingMonth ? <Loader2 size={12} className="animate-spin" /> : <Copy size={12} />}
            Copy Last Month
          </button>
        </div>

        {error && <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl p-3 text-red-600 dark:text-red-300 text-sm">{error}</div>}

        {/* Empty state */}
        {isEmpty ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm px-6 py-12 flex flex-col items-center text-center gap-4">
            <span className="text-6xl">📅</span>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">Let's create your {MONTHS[month - 1]} budget.</p>
              <p className="text-gray-500 dark:text-gray-400 text-sm mt-2">We'll copy last month's budget to get you started.</p>
            </div>
            <button
              onClick={copyLastMonth}
              disabled={copyingMonth}
              className="w-full py-3.5 bg-[#1a2e4a] hover:bg-[#162540] text-white font-semibold rounded-2xl text-base transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {copyingMonth ? <Loader2 size={16} className="animate-spin" /> : null}
              Create {MONTHS[month - 1]} Budget
            </button>
          </div>
        ) : (
          <>
            {/* Hero summary card */}
            <div className={cn(
              'bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-5 flex flex-col sm:flex-row items-center gap-4 sm:gap-0',
              isOver && 'bg-red-600',
              isZero && 'bg-blue-600'
            )}>
              {/* Income */}
              <div className="flex-1 text-center sm:text-left">
                <p className={cn('text-xs font-medium uppercase tracking-wider mb-0.5', isOver || isZero ? 'text-white/70' : 'text-gray-500 dark:text-gray-400')}>
                  Income
                </p>
                {editingIncome ? (
                  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                    <span className={cn('text-sm', isOver || isZero ? 'text-white/80' : 'text-gray-500 dark:text-gray-400')}>$</span>
                    <input autoFocus value={incomeInput}
                      onChange={e => setIncomeInput(e.target.value)}
                      onBlur={saveIncome}
                      onKeyDown={e => e.key === 'Enter' && saveIncome()}
                      className="bg-white/20 text-white placeholder-white/50 text-2xl font-bold w-32 rounded px-1 focus:outline-none focus:ring-1 focus:ring-white/60 border border-white/30" />
                  </div>
                ) : (
                  <button onClick={() => { setEditingIncome(true); setIncomeInput(String(budget?.total_income ?? 0)) }}
                    className={cn('text-2xl font-bold transition-opacity hover:opacity-80', isOver || isZero ? 'text-white' : 'text-gray-900 dark:text-gray-100')}>
                    {fmt(budget?.total_income ?? 0)}
                  </button>
                )}
                <p className={cn('text-xs mt-0.5', isOver || isZero ? 'text-white/60' : 'text-gray-400 dark:text-gray-500')}>
                  click to edit
                </p>
              </div>

              <div className={cn('hidden sm:block w-px h-12 mx-6', isOver || isZero ? 'bg-white/20' : 'bg-gray-200 dark:bg-gray-700')} />

              {/* Budgeted */}
              <div className="flex-1 text-center">
                <p className={cn('text-xs font-medium uppercase tracking-wider mb-0.5', isOver || isZero ? 'text-white/70' : 'text-gray-500 dark:text-gray-400')}>
                  Budgeted
                </p>
                <p className={cn('text-2xl font-bold', isOver || isZero ? 'text-white' : 'text-gray-900 dark:text-gray-100')}>
                  {fmt(budget?.total_budgeted ?? 0)}
                </p>
                <p className={cn('text-xs mt-0.5', isOver || isZero ? 'text-white/60' : 'text-gray-400 dark:text-gray-500')}>
                  assigned
                </p>
              </div>

              <div className={cn('hidden sm:block w-px h-12 mx-6', isOver || isZero ? 'bg-white/20' : 'bg-gray-200 dark:bg-gray-700')} />

              {/* Left to Budget */}
              <div className="flex-1 text-center sm:text-right">
                <p className={cn('text-xs font-medium uppercase tracking-wider mb-0.5', isOver || isZero ? 'text-white/70' : 'text-gray-500 dark:text-gray-400')}>
                  {isOver ? 'Over Budget' : 'Left to Budget'}
                </p>
                <p className={cn('text-3xl font-bold', isOver || isZero ? 'text-white' : 'text-blue-600')}>
                  {fmt(Math.abs(leftToBudget))}
                </p>
                <p className={cn('text-xs mt-0.5', isOver || isZero ? 'text-white/60' : 'text-gray-400 dark:text-gray-500')}>
                  {isZero ? '🎉 Zero-based!' : isOver ? 'reduce categories' : 'unassigned'}
                </p>
              </div>
            </div>

            <PaycheckCard year={year} month={month} totalIncome={budget?.total_income} onSyncIncome={updateIncome} />

            {/* Budget Groups — Income is shown by PaycheckCard above, not as an expense group */}
            {budget?.groups.filter(g => g.name !== 'Income').map(group => (
              <GroupCard
                key={group.id}
                group={group}
                collapsed={collapsedGroups.has(group.id)}
                onToggle={() => toggleGroup(group.id)}
                editingCategory={editingCategory}
                categoryInput={categoryInput}
                onStartEdit={(id, val) => { setEditingCategory(id); setCategoryInput(String(val)) }}
                onInputChange={setCategoryInput}
                onSaveCategory={saveCategory}
                addingCategory={addingCategoryGroup === group.id}
                newCategoryName={newCategoryName}
                onStartAdd={() => setAddingCategoryGroup(group.id)}
                onNewCategoryChange={setNewCategoryName}
                onSubmitAdd={() => submitAddCategory(group.id)}
                onCancelAdd={() => { setAddingCategoryGroup(null); setNewCategoryName('') }}
                alerts={alerts}
                triggeredAlerts={triggeredAlerts}
                onUpsertAlert={upsertAlert}
                onDeleteAlert={deleteAlert}
                onRename={renameCategory}
              />
            ))}

            {/* Spending Alerts panel */}
            {triggeredAlerts.filter(a => a.triggered).length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-red-200 dark:border-red-800 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Bell size={14} className="text-red-500" />
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Spending Alerts</h3>
                  <span className="ml-auto text-xs bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-300 px-1.5 py-0.5 rounded-full font-medium">
                    {triggeredAlerts.filter(a => a.triggered).length}
                  </span>
                </div>
                <div className="space-y-2">
                  {triggeredAlerts.filter(a => a.triggered).map(a => (
                    <div key={a.alert_id} className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">{a.category_name}</p>
                        <p className="text-xs text-red-600 dark:text-red-400">{a.pct_used}% used · {fmt(a.spent)} of {fmt(a.budgeted)}</p>
                      </div>
                      <span className="text-xs px-1.5 py-0.5 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-300 rounded-full whitespace-nowrap shrink-0">
                        over {a.threshold_pct}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Spending by Group */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp size={14} className="text-blue-600" />
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Spending by Group</h3>
              </div>
              <div className="space-y-2.5">
                {budget?.groups.filter(g => g.name !== 'Income').map(g => {
                  const pct = g.budgeted > 0 ? Math.min(100, (g.spent / g.budgeted) * 100) : 0
                  const over = g.spent > g.budgeted && g.budgeted > 0
                  return (
                    <div key={g.id}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-600 dark:text-gray-400 truncate max-w-[120px]">{g.name}</span>
                        <span className={over ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-500 dark:text-gray-400'}>{fmt(g.spent)} / {fmt(g.budgeted)}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div className={cn('h-full rounded-full transition-all', over ? 'bg-red-500' : 'bg-blue-500')}
                          style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* AI Insights */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Sparkles size={14} className="text-amber-500" />
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">AI Insights</h3>
                </div>
                <button onClick={fetchInsights} disabled={loadingInsights}
                  className="text-xs px-2.5 py-1 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 rounded-lg transition-colors disabled:opacity-50 font-medium">
                  {loadingInsights ? <Loader2 size={10} className="animate-spin inline" /> : 'Get Insights'}
                </button>
              </div>
              {insights ? (
                <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{insights}</p>
              ) : (
                <p className="text-xs text-gray-400 dark:text-gray-500">Click "Get Insights" to analyze your budget with AI.</p>
              )}
            </div>

            {/* Recurring Bills */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <Repeat2 size={14} className="text-purple-500" />
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Bills &amp; Subscriptions</h3>
              </div>
              {loadingRecurring ? (
                <div className="flex justify-center py-3"><Loader2 size={16} className="animate-spin text-gray-400" /></div>
              ) : recurring.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-gray-500">No recurring transactions detected.</p>
              ) : (
                <div className="space-y-2">
                  {recurring.slice(0, 8).map((r, i) => (
                    <div key={i} className="flex justify-between items-center">
                      <span className="text-xs text-gray-700 dark:text-gray-300 truncate max-w-[140px]">{r.merchant}</span>
                      <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">{fmt2(r.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Live Feed */}
            {recentTransactions.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Live Transactions</h3>
                <div className="space-y-2">
                  {recentTransactions.slice(0, 5).map((t, i) => (
                    <div key={i} className="flex justify-between items-center">
                      <div className="min-w-0">
                        <p className="text-xs text-gray-700 dark:text-gray-300 truncate">{t.merchant_name || t.name}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">{t.date}</p>
                      </div>
                      <span className={cn('text-xs font-semibold ml-2', t.amount < 0 ? 'text-blue-600' : 'text-red-500')}>
                        {t.amount < 0 ? '+' : ''}{fmt2(Math.abs(t.amount))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sync status */}
            {syncStatus.last_synced_at && (
              <p className="text-xs text-gray-400 dark:text-gray-500 text-center pb-2">
                Last synced: {new Date(syncStatus.last_synced_at).toLocaleString()}
                {syncStatus.last_added > 0 && ` (+${syncStatus.last_added} txns)`}
              </p>
            )}
          </>
        )}
      </div>

      {/* Toast notifications */}
      <div className="fixed bottom-4 right-4 z-50 space-y-2">
        {toasts.map(t => (
          <div key={t.id} role="alert" className="flex items-center gap-2 bg-red-600 border border-red-500 rounded-xl px-4 py-2.5 text-sm text-white shadow-xl max-w-xs">
            <span className="flex-1">{t.message}</span>
            <button onClick={() => setToasts(ts => ts.filter(x => x.id !== t.id))} aria-label="Dismiss alert" className="text-red-100 hover:text-white">
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

interface GroupCardProps {
  group: BudgetGroup
  collapsed: boolean
  onToggle: () => void
  editingCategory: string | null
  categoryInput: string
  onStartEdit: (id: string, val: number) => void
  onInputChange: (v: string) => void
  onSaveCategory: (id: string) => void
  addingCategory: boolean
  newCategoryName: string
  onStartAdd: () => void
  onNewCategoryChange: (v: string) => void
  onSubmitAdd: () => void
  onCancelAdd: () => void
  alerts: SpendingAlert[]
  triggeredAlerts: TriggeredAlert[]
  onUpsertAlert: (catId: string, threshold: number) => void
  onDeleteAlert: (catId: string) => void
  onRename: (catId: string, name: string) => void
}

function GroupCard({ group, collapsed, onToggle, editingCategory, categoryInput, onStartEdit, onInputChange, onSaveCategory, addingCategory, newCategoryName, onStartAdd, onNewCategoryChange, onSubmitAdd, onCancelAdd, alerts, triggeredAlerts, onUpsertAlert, onDeleteAlert, onRename }: GroupCardProps) {
  const over = group.spent > group.budgeted && group.budgeted > 0

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
      {/* Group header */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        aria-controls={`group-${group.id}`}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onToggle()}
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors border-b border-gray-100 dark:border-gray-700"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2 min-w-0">
          <ChevronDown size={14} aria-hidden="true" className={cn('text-gray-400 dark:text-gray-500 shrink-0 transition-transform', collapsed && '-rotate-90')} />
          <span className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{group.name}</span>
        </div>
        <div className="flex items-center gap-5 shrink-0 text-xs">
          <div className="text-right">
            <p className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-wider">Planned</p>
            <p className="font-semibold text-gray-700 dark:text-gray-300">{fmt(group.budgeted)}</p>
          </div>
          <div className="text-right">
            <p className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-wider">Spent</p>
            <p className={cn('font-semibold', over ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300')}>{fmt(group.spent)}</p>
          </div>
          <div className="text-right">
            <p className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-wider">Remaining</p>
            <p className={cn('font-semibold', group.remaining < 0 ? 'text-red-600 dark:text-red-400' : 'text-blue-600')}>{fmt(group.remaining)}</p>
          </div>
        </div>
      </div>

      {!collapsed && (
        <div id={`group-${group.id}`}>
          {/* Column header row */}
          <div className="flex items-center px-4 py-1.5 bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-700">
            <span className="flex-1 text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider pl-4">Category</span>
            <div className="flex items-center gap-0 shrink-0">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider w-20 text-right">Planned</span>
              <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider w-20 text-right">Spent</span>
              <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider w-20 text-right">Remaining</span>
            </div>
          </div>

          {group.categories.map(cat => {
            const alert = alerts.find(a => a.category_id === cat.id)
            const triggered = triggeredAlerts.find(a => a.category_id === cat.id)
            return (
              <CategoryRow
                key={cat.id}
                cat={cat}
                editing={editingCategory === cat.id}
                input={categoryInput}
                onStartEdit={() => onStartEdit(cat.id, cat.budgeted)}
                onInputChange={onInputChange}
                onSave={() => onSaveCategory(cat.id)}
                alert={alert}
                triggered={triggered}
                onUpsertAlert={onUpsertAlert}
                onDeleteAlert={onDeleteAlert}
                onRename={onRename}
              />
            )
          })}

          {/* Add Category */}
          {addingCategory ? (
            <div className="flex items-center gap-2 px-4 py-2.5 border-t border-gray-100 dark:border-gray-700">
              <input autoFocus value={newCategoryName}
                onChange={e => onNewCategoryChange(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') onSubmitAdd(); if (e.key === 'Escape') onCancelAdd() }}
                placeholder="Category name…"
                className="flex-1 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-xs rounded border border-gray-300 dark:border-gray-600 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              <button onClick={onSubmitAdd} className="text-xs px-3 py-1.5 bg-[#1a2e4a] hover:bg-[#162540] text-white rounded-xl transition-colors font-medium">Add</button>
              <button onClick={onCancelAdd} className="text-xs px-3 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-xl transition-colors">Cancel</button>
            </div>
          ) : (
            <button onClick={onStartAdd}
              className="flex items-center gap-1 px-4 py-2.5 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors border-t border-gray-100 dark:border-gray-700 w-full font-medium">
              <Plus size={11} /><span>Add Budget Item</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function CategoryRow({ cat, editing, input, onStartEdit, onInputChange, onSave, alert, triggered, onUpsertAlert, onDeleteAlert, onRename }: {
  cat: BudgetCategory; editing: boolean; input: string
  onStartEdit: () => void; onInputChange: (v: string) => void; onSave: () => void
  alert?: SpendingAlert; triggered?: TriggeredAlert
  onUpsertAlert: (catId: string, threshold: number) => void
  onDeleteAlert: (catId: string) => void
  onRename: (catId: string, name: string) => void
}) {
  const [showAlertPopover, setShowAlertPopover] = useState(false)
  const [thresholdInput, setThresholdInput] = useState(String(alert?.threshold_pct ?? 80))
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState(cat.name)

  const saveName = () => {
    setEditingName(false)
    const trimmed = nameInput.trim()
    if (trimmed && trimmed !== cat.name) onRename(cat.id, trimmed)
    else setNameInput(cat.name)
  }
  const pct = cat.budgeted > 0 ? Math.min(100, (cat.spent / cat.budgeted) * 100) : cat.spent > 0 ? 100 : 0
  const over = cat.spent > cat.budgeted && cat.budgeted > 0
  const barColor = over ? 'bg-red-500' : pct >= 85 ? 'bg-amber-400' : 'bg-blue-500'
  const alertTriggered = triggered?.triggered ?? false
  const alertSet = !!alert?.enabled

  return (
    <div className="border-t border-gray-100 dark:border-gray-700 group">
      <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors">
        <div className="flex-1 min-w-0 flex items-center gap-1.5 pl-4">
          {editingName ? (
            <input autoFocus value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onBlur={saveName}
              onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setNameInput(cat.name); setEditingName(false) } }}
              className="text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded border border-blue-400 px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-0 flex-1" />
          ) : (
            <button onClick={() => { setNameInput(cat.name); setEditingName(true) }}
              className="text-sm text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 truncate text-left transition-colors">
              {cat.name}
            </button>
          )}
          <div className="relative">
            <button
              onClick={() => { setThresholdInput(String(alert?.threshold_pct ?? 80)); setShowAlertPopover(v => !v) }}
              className={cn(
                'opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded',
                alertTriggered ? 'opacity-100 text-red-500 hover:text-red-600' :
                alertSet ? 'opacity-100 text-amber-500 hover:text-amber-600' :
                'text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400'
              )}
            >
              <Bell size={11} />
            </button>
            {showAlertPopover && (
              <div className="absolute left-0 top-6 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-3 w-52">
                <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 mb-2">Spending Alert</p>
                <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Alert when spent reaches</label>
                <div className="flex items-center gap-2 mb-3">
                  <input type="number" min="1" max="100" value={thresholdInput}
                    onChange={e => setThresholdInput(e.target.value)}
                    className="w-16 text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-900" />
                  <span className="text-xs text-gray-500 dark:text-gray-400">% of budget</span>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => { onUpsertAlert(cat.id, parseInt(thresholdInput) || 80); setShowAlertPopover(false) }}
                    className="flex-1 text-xs py-1.5 bg-[#1a2e4a] hover:bg-[#162540] text-white rounded-xl font-medium transition-colors">
                    Save
                  </button>
                  {alertSet && (
                    <button onClick={() => { onDeleteAlert(cat.id); setShowAlertPopover(false) }}
                      className="text-xs px-2 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-xl transition-colors">
                      Remove
                    </button>
                  )}
                  <button onClick={() => setShowAlertPopover(false)}
                    className="text-xs px-2 py-1.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                    ✕
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center shrink-0">
          {/* Planned — editable */}
          {editing ? (
            <div className="flex items-center gap-0.5 w-20 justify-end">
              <span className="text-gray-400 dark:text-gray-500 text-xs">$</span>
              <input autoFocus value={input}
                onChange={e => onInputChange(e.target.value)}
                onBlur={onSave}
                onKeyDown={e => e.key === 'Enter' && onSave()}
                className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 w-16 rounded border border-blue-400 px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs text-right" />
            </div>
          ) : (
            <button onClick={onStartEdit}
              className="text-xs text-gray-700 dark:text-gray-300 hover:text-blue-600 w-20 text-right transition-colors font-medium">
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(cat.budgeted)}
            </button>
          )}
          <span className={cn('text-xs w-20 text-right', over ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-600 dark:text-gray-400')}>
            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(cat.spent)}
          </span>
          <span className={cn('text-xs w-20 text-right font-semibold', cat.remaining < 0 ? 'text-red-600 dark:text-red-400' : 'text-blue-600')}>
            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(cat.remaining)}
          </span>
        </div>
      </div>
      {/* Progress bar */}
      <div className="h-[3px] bg-gray-100 dark:bg-gray-700 mx-4 mb-0.5 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-300', barColor)}
          style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
