'use client'
import { useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Receipt, Filter } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'

import { apiFetch, BASE } from '@/lib/api'
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

interface Transaction {
  id: string
  name: string
  merchant_name: string | null
  amount: number
  date: string
  category_id: string | null
  category_name: string | null
  pending: boolean
}

interface Category {
  id: string
  name: string
  group_name: string
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export default function TransactionsPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'unassigned'>('all')
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const navMonth = (dir: number) => {
    let m = month + dir, y = year
    if (m < 1) { m = 12; y-- }
    if (m > 12) { m = 1; y++ }
    setMonth(m); setYear(y)
  }

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [txRes, budgetRes] = await Promise.all([
        apiFetch<any>(`/api/v1/budget/transactions?year=${year}&month=${month}`),
        apiFetch<any>(`/api/v1/budget/month/${year}/${month}`)
      ])
      const txData = txRes
      const budgetData = budgetRes
      const rawTransactions = Array.isArray(txData) ? txData : txData.transactions ?? []
      const cats: { id: string; name: string }[] = []
      const categoryList: Category[] = []
      for (const group of budgetData.groups ?? []) {
        for (const cat of group.categories ?? []) {
          cats.push({ id: cat.id, name: cat.name })
          categoryList.push({ id: cat.id, name: cat.name, group_name: group.name })
        }
      }
      setTransactions(rawTransactions.map((t: any) => ({
        ...t,
        category_id: t.budget_category_id,
        category_name: cats.find(c => c.id === t.budget_category_id)?.name ?? null
      })))
      setCategories(categoryList)
    } catch {} finally { setLoading(false) }
  }, [year, month])

  useEffect(() => { fetchData() }, [fetchData])

  const assignCategory = async (txId: string, categoryId: string) => {
    setUpdatingId(txId)
    try {
      await apiFetch(`/api/v1/budget/transactions/${txId}/category`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ budget_category_id: categoryId || null })
      })
      setTransactions(ts => ts.map(t => t.id === txId ? {
        ...t,
        category_id: categoryId || null,
        category_name: categories.find(c => c.id === categoryId)?.name ?? null
      } : t))
    } catch {} finally { setUpdatingId(null) }
  }

  const filtered = filter === 'unassigned' ? transactions.filter(t => !t.category_id) : transactions
  const totalSpent = filtered.filter(t => t.amount > 0 && !t.pending).reduce((s, t) => s + t.amount, 0)
  const totalIncome = filtered.filter(t => t.amount < 0 && !t.pending).reduce((s, t) => s + Math.abs(t.amount), 0)

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="animate-spin text-blue-600" size={32} />
    </div>
  )

  return (
    <div>
      <PageHeader
        title={`${MONTHS[month - 1]} ${year}`}
        left={
          <div className="flex items-center gap-1">
            <button onClick={() => navMonth(-1)} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-colors">
              <ChevronLeft size={16} />
            </button>
            <button onClick={() => navMonth(1)} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>
        }
        right={
          <div className="flex bg-white/20 rounded-lg p-0.5">
            <button onClick={() => setFilter('all')} className={cn('text-xs px-3 py-1.5 rounded-md transition-colors font-medium', filter === 'all' ? 'bg-white text-gray-900 shadow-sm' : 'text-white/80 hover:text-white')}>
              All
            </button>
            <button onClick={() => setFilter('unassigned')} className={cn('text-xs px-3 py-1.5 rounded-md transition-colors flex items-center gap-1 font-medium', filter === 'unassigned' ? 'bg-white text-gray-900 shadow-sm' : 'text-white/80 hover:text-white')}>
              <Filter size={10} />Unassigned
            </button>
          </div>
        }
      />
      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <p className="text-xs text-gray-500 mb-1">Transactions</p>
            <p className="text-xl font-bold text-gray-900">{filtered.length}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <p className="text-xs text-gray-500 mb-1">Total Spent</p>
            <p className="text-xl font-bold text-red-500">{fmt(totalSpent)}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <p className="text-xs text-gray-500 mb-1">Income</p>
            <p className="text-xl font-bold text-blue-600">{fmt(totalIncome)}</p>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm p-12 text-center">
            <Receipt size={40} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600 font-medium">No transactions found</p>
            <p className="text-sm text-gray-400 mt-1">
              {filter === 'unassigned' ? 'All transactions are categorized.' : 'No transactions for this period.'}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="divide-y divide-gray-100">
              {filtered.map(tx => {
                const [, , dayStr] = tx.date.split('-')
                const monthIdx = parseInt(tx.date.split('-')[1]) - 1
                const shortMonth = SHORT_MONTHS[monthIdx] ?? ''
                const day = parseInt(dayStr ?? '0', 10)
                return (
                  <div key={tx.id} className={cn(
                    'flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors',
                    tx.pending && 'opacity-60'
                  )}>
                    <div className="flex flex-col items-center justify-center w-10 h-10 rounded-full bg-gray-100 shrink-0">
                      <span className="text-[9px] text-gray-500 uppercase leading-none">{shortMonth}</span>
                      <span className="text-sm font-bold text-gray-900 leading-none">{day}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-900 truncate">{tx.merchant_name || tx.name}</p>
                      {tx.category_name && (
                        <p className="text-xs text-blue-600 font-medium">{tx.category_name}</p>
                      )}
                      {tx.pending && <span className="text-xs text-amber-500">Pending</span>}
                    </div>
                    <div className="min-w-[140px]">
                      {updatingId === tx.id ? (
                        <div className="flex justify-end"><Loader2 size={12} className="animate-spin text-gray-400" /></div>
                      ) : (
                        <select
                          value={tx.category_id ?? ''}
                          onChange={e => assignCategory(tx.id, e.target.value)}
                          className="bg-white text-gray-900 text-xs rounded-xl px-2 py-1 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 w-full"
                        >
                          <option value="">— Uncategorized —</option>
                          {Object.entries(
                            categories.reduce((groups: Record<string, Category[]>, cat) => {
                              if (!groups[cat.group_name]) groups[cat.group_name] = []
                              groups[cat.group_name].push(cat)
                              return groups
                            }, {})
                          ).map(([groupName, cats]) => (
                            <optgroup key={groupName} label={groupName}>
                              {cats.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      )}
                    </div>
                    <span className={cn('text-sm font-semibold whitespace-nowrap text-right', tx.amount < 0 ? 'text-blue-600' : 'text-gray-900')}>
                      {tx.amount < 0 ? '+' : ''}{fmt(Math.abs(tx.amount))}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
