'use client'
import { useState, useEffect, useCallback } from 'react'
import { BarChart2, Loader2, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'

import { apiFetch, BASE } from '@/lib/api'
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December']

interface YearMonth {
  month: number; income: number; spent: number
}

interface GroupTrend {
  group_name: string
  months: Record<string, number>
}

interface Merchant {
  name: string; amount: number; count: number
}

interface CategoryBreakdown {
  group_name: string
  categories: { name: string; spent: number; budgeted: number }[]
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

function fmt2(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

type TrendWindow = 3 | 6 | 12

export default function SpendingPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [yearData, setYearData] = useState<YearMonth[]>([])
  const [groupTrends, setGroupTrends] = useState<GroupTrend[]>([])
  const [merchants, setMerchants] = useState<Merchant[]>([])
  const [breakdown, setBreakdown] = useState<CategoryBreakdown[]>([])
  const [loading, setLoading] = useState(true)
  const [trendWindow, setTrendWindow] = useState<TrendWindow>(6)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [yr, gt, mc, bm] = await Promise.all([
        apiFetch(`/api/v1/spending-analytics/year-summary?year=${year}`).catch(() => null),
        apiFetch(`/api/v1/spending-analytics/trend?months=${trendWindow}`).catch(() => []),
        apiFetch(`/api/v1/spending-analytics/top-merchants?year=${year}&month=${month}`).catch(() => []),
        apiFetch(`/api/v1/budget/month/${year}/${month}`).catch(() => null),
      ])
      setYearData(yr?.months ?? [])
      const trendData: { year: number; month: number; groups: Record<string, number> }[] = Array.isArray(gt) ? gt : []
      const groupNames = new Set<string>()
      trendData.forEach(m => Object.keys(m.groups ?? {}).forEach(g => groupNames.add(g)))
      const pivoted: GroupTrend[] = Array.from(groupNames).map(name => ({
        group_name: name,
        months: Object.fromEntries(trendData.map(m => [`${m.year}-${String(m.month).padStart(2, '0')}`, m.groups?.[name] ?? 0])),
      }))
      setGroupTrends(pivoted)
      const merchantsMapped: Merchant[] = (Array.isArray(mc) ? mc : []).map((m: any) => ({ name: m.merchant, amount: m.total, count: m.count }))
      setMerchants(merchantsMapped)
      const breakdownMapped: CategoryBreakdown[] = (bm?.groups ?? []).map((g: any) => ({
        group_name: g.name,
        categories: (g.categories ?? []).map((c: any) => ({ name: c.name, budgeted: c.budgeted, spent: c.spent })),
      }))
      setBreakdown(breakdownMapped)
    } catch {} finally { setLoading(false) }
  }, [year, month, trendWindow])

  useEffect(() => { fetchAll() }, [fetchAll])

  const maxSpent = Math.max(...yearData.map(d => Math.max(d.income, d.spent)), 1)

  const trendMonths: string[] = []
  for (let i = trendWindow - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    trendMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const maxMerchant = Math.max(...merchants.map(m => m.amount), 1)

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="animate-spin text-blue-600" size={32} />
    </div>
  )

  return (
    <div>
      <PageHeader
        title="Insights"
        right={
          <div className="flex items-center gap-2">
            <select value={year} onChange={e => setYear(Number(e.target.value))}
              className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm rounded-xl px-3 py-1.5 border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500">
              {[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear()].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <select value={month} onChange={e => setMonth(Number(e.target.value))}
              className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm rounded-xl px-3 py-1.5 border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500">
              {MONTH_FULL.map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
        }
      />
      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">

      {/* Year at a Glance */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4">
        <div className="flex items-center gap-2 mb-4">
          <BarChart2 size={14} className="text-blue-600" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{year} at a Glance</h3>
          <div className="ml-auto flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-500 inline-block" />Income</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-orange-400 inline-block" />Spent</span>
          </div>
        </div>
        {yearData.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">No data for {year}</p>
        ) : (
          <div className="space-y-1.5">
            {MONTHS.map((m, idx) => {
              const mo = idx + 1
              const d = yearData.find(x => x.month === mo)
              const isCurrentMonth = mo === month && year === now.getFullYear()
              const incPct = d ? (d.income / maxSpent) * 100 : 0
              const sptPct = d ? (d.spent / maxSpent) * 100 : 0
              return (
                <div key={m}
                  className={cn('rounded-lg px-3 py-2 cursor-pointer transition-colors', isCurrentMonth ? 'bg-blue-50 dark:bg-blue-950/40 ring-1 ring-blue-200 dark:ring-blue-800' : 'hover:bg-gray-50 dark:hover:bg-gray-700')}
                  onClick={() => setMonth(mo)}>
                  <div className="flex items-center gap-3">
                    <span className={cn('text-xs w-8 shrink-0', isCurrentMonth ? 'text-blue-700 dark:text-blue-400 font-bold' : 'text-gray-400 dark:text-gray-500')}>{m}</span>
                    <div className="flex-1 space-y-1">
                      <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${incPct}%` }} />
                      </div>
                      <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div className={cn('h-full rounded-full transition-all', d && d.spent > d.income ? 'bg-red-400' : 'bg-orange-400')} style={{ width: `${sptPct}%` }} />
                      </div>
                    </div>
                    <div className="text-right w-32 shrink-0">
                      {d ? (
                        <div className="text-xs">
                          <span className="text-blue-600">{fmt(d.income)}</span>
                          <span className="text-gray-300 dark:text-gray-600 mx-1">/</span>
                          <span className={d.spent > d.income ? 'text-red-500' : 'text-orange-500'}>{fmt(d.spent)}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Group Trend Table */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp size={14} className="text-blue-500" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Monthly Group Trends</h3>
            </div>
            <div className="flex bg-gray-100 dark:bg-gray-900 rounded-lg p-0.5">
              {([3, 6, 12] as TrendWindow[]).map(w => (
                <button key={w} onClick={() => setTrendWindow(w)}
                  className={cn('text-xs px-2 py-1 rounded-md transition-colors font-medium', trendWindow === w ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200')}>
                  {w}mo
                </button>
              ))}
            </div>
          </div>
          {groupTrends.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">No trend data available</p>
          ) : (
            <div className="overflow-x-auto scrollbar-none">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left text-gray-400 dark:text-gray-500 font-medium pb-2 pr-3">Group</th>
                    {trendMonths.map(m => (
                      <th key={m} className="text-right text-gray-400 dark:text-gray-500 font-medium pb-2 px-1 whitespace-nowrap">
                        {MONTHS[parseInt(m.split('-')[1]) - 1]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                  {groupTrends.map(g => {
                    const vals = trendMonths.map(m => g.months[m] ?? 0)
                    const maxVal = Math.max(...vals, 1)
                    return (
                      <tr key={g.group_name}>
                        <td className="py-2 pr-3 text-gray-700 dark:text-gray-300 font-medium truncate max-w-[100px]">{g.group_name}</td>
                        {trendMonths.map((m, i) => {
                          const val = vals[i]
                          const intensity = val > 0 ? Math.max(10, Math.round((val / maxVal) * 100)) : 0
                          return (
                            <td key={m} className="text-right px-1 py-2">
                              <span className={cn(
                                'inline-block px-1.5 py-0.5 rounded text-xs font-medium',
                                intensity === 0 ? 'text-gray-300 dark:text-gray-600' :
                                intensity < 30 ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300' :
                                intensity < 60 ? 'bg-yellow-50 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-300' :
                                intensity < 85 ? 'bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-300' :
                                'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-300'
                              )}>
                                {val > 0 ? fmt(val) : '—'}
                              </span>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Top Merchants */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Top Merchants — {MONTH_FULL[month - 1]} {year}
          </h3>
          {merchants.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">No merchant data for this period</p>
          ) : (
            <div className="space-y-2.5">
              {merchants.slice(0, 10).map((m, i) => (
                <div key={m.name}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                      <span className="text-gray-300 dark:text-gray-600 w-4 text-right">{i + 1}.</span>
                      <span className="truncate max-w-[150px]">{m.name}</span>
                      <span className="text-gray-400 dark:text-gray-500">({m.count}x)</span>
                    </span>
                    <span className="text-gray-900 dark:text-gray-100 font-medium">{fmt2(m.amount)}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-400 rounded-full transition-all" style={{ width: `${(m.amount / maxMerchant) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Category Breakdown */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Category Breakdown — {MONTH_FULL[month - 1]} {year}
        </h3>
        {breakdown.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">No breakdown data for this period</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {breakdown.map(group => (
              <div key={group.group_name} className="space-y-2">
                <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{group.group_name}</p>
                {group.categories.map(cat => {
                  const pct = cat.budgeted > 0 ? Math.min(100, (cat.spent / cat.budgeted) * 100) : cat.spent > 0 ? 100 : 0
                  const over = cat.spent > cat.budgeted && cat.budgeted > 0
                  return (
                    <div key={cat.name}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-gray-600 dark:text-gray-300 truncate max-w-[120px]">{cat.name}</span>
                        <span className={over ? 'text-red-500 font-medium' : 'text-gray-500 dark:text-gray-400'}>{fmt(cat.spent)}</span>
                      </div>
                      <div className="h-1 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div className={cn('h-full rounded-full', over ? 'bg-red-400' : 'bg-blue-500')}
                          style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  )
}
