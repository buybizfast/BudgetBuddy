'use client'
import { useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight, Download, Printer, Loader2, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'
import { apiFetch, BASE } from '@/lib/api'
import { getToken } from '@/lib/auth'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}
function fmt2(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

interface Report {
  year: number
  month: number
  summary: { total_income: number; total_spent: number; net: number; total_debt: number; total_saved: number; transaction_count: number }
  budget: { groups: { name: string; categories: { name: string; budgeted: number; spent: number }[] }[] }
  transactions: { date: string; name: string; merchant_name: string; amount: number; account_name: string; budget_category: string }[]
  debts: { name: string; balance: number; interest_rate: number; is_paid_off: boolean }[]
  goals: { name: string; current_amount: number; target_amount: number; icon: string }[]
  accounts: { name: string; type: string; current_balance: number; institution_name: string }[]
}

export default function ReportPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)

  const navMonth = (dir: number) => {
    let m = month + dir, y = year
    if (m < 1) { m = 12; y-- }
    if (m > 12) { m = 1; y++ }
    setMonth(m); setYear(y)
  }

  const fetchReport = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch<Report>(`/api/v1/report/${year}/${month}`)
      setReport(data)
    } catch {} finally { setLoading(false) }
  }, [year, month])

  useEffect(() => { fetchReport() }, [fetchReport])

  const downloadCSV = async () => {
    setDownloading(true)
    try {
      const token = getToken()
      const res = await fetch(`${BASE}/api/v1/report/${year}/${month}/csv`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `BudgetBuddy_${MONTHS[month - 1]}_${year}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {} finally { setDownloading(false) }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="animate-spin text-blue-600" size={32} />
    </div>
  )

  const s = report?.summary

  return (
    <div>
      <PageHeader
        title="Monthly Report"
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
          <div className="flex items-center gap-2">
            <button onClick={downloadCSV} disabled={downloading}
              className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
              <Download size={13} />
              {downloading ? 'Downloading…' : 'CSV'}
            </button>
            <button onClick={() => window.print()}
              className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
              <Printer size={13} />
              PDF
            </button>
          </div>
        }
      />

      {/* Print styles */}
      <style>{`
        @media print {
          nav, header, .no-print { display: none !important; }
          body { background: white !important; }
          .print-page { padding: 0 !important; }
        }
      `}</style>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4 print-page">
        {/* Report header for print */}
        <div className="hidden print:block text-center py-4 border-b border-gray-200 mb-4">
          <h1 className="text-2xl font-bold text-gray-900">BudgetBuddy Monthly Report</h1>
          <p className="text-gray-500">{MONTHS[month - 1]} {year}</p>
        </div>

        {/* Month label */}
        <p className="text-sm font-semibold text-gray-500 text-center">{MONTHS[month - 1]} {year}</p>

        {/* Summary cards */}
        {s && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-2xl shadow-sm p-4">
              <p className="text-xs text-gray-400 mb-1">Income</p>
              <p className="text-xl font-bold text-green-600">{fmt(s.total_income)}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm p-4">
              <p className="text-xs text-gray-400 mb-1">Spent</p>
              <p className="text-xl font-bold text-red-500">{fmt(s.total_spent)}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm p-4">
              <p className="text-xs text-gray-400 mb-1">Net</p>
              <p className={cn('text-xl font-bold', s.net >= 0 ? 'text-blue-600' : 'text-red-500')}>{fmt(s.net)}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm p-4">
              <p className="text-xs text-gray-400 mb-1">Transactions</p>
              <p className="text-xl font-bold text-gray-900">{s.transaction_count}</p>
            </div>
          </div>
        )}

        {/* Budget by category */}
        {report?.budget?.groups && report.budget.groups.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Budget vs Actual</h2>
            </div>
            <div className="divide-y divide-gray-50">
              {report.budget.groups.map(group => {
                const groupSpent = group.categories.reduce((s, c) => s + (c.spent ?? 0), 0)
                const groupBudgeted = group.categories.reduce((s, c) => s + c.budgeted, 0)
                if (groupBudgeted === 0 && groupSpent === 0) return null
                return (
                  <div key={group.name}>
                    <div className="flex items-center justify-between px-4 py-2 bg-gray-50">
                      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{group.name}</p>
                      <div className="flex gap-4 text-xs text-gray-500">
                        <span>Budget: <span className="font-semibold text-gray-700">{fmt(groupBudgeted)}</span></span>
                        <span>Spent: <span className={cn('font-semibold', groupSpent > groupBudgeted && groupBudgeted > 0 ? 'text-red-500' : 'text-gray-700')}>{fmt(groupSpent)}</span></span>
                      </div>
                    </div>
                    {group.categories.filter(c => c.budgeted > 0 || (c.spent ?? 0) > 0).map(cat => {
                      const spent = cat.spent ?? 0
                      const over = spent > cat.budgeted && cat.budgeted > 0
                      const pct = cat.budgeted > 0 ? Math.min(100, (spent / cat.budgeted) * 100) : 0
                      return (
                        <div key={cat.name} className="px-4 py-2">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-xs text-gray-700">{cat.name}</p>
                            <div className="flex gap-3 text-xs">
                              <span className="text-gray-400">{fmt(cat.budgeted)}</span>
                              <span className={cn('font-semibold', over ? 'text-red-500' : 'text-gray-700')}>{fmt(spent)}</span>
                            </div>
                          </div>
                          {cat.budgeted > 0 && (
                            <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                              <div className={cn('h-full rounded-full', over ? 'bg-red-400' : pct > 80 ? 'bg-amber-400' : 'bg-blue-400')}
                                style={{ width: `${pct}%` }} />
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Accounts snapshot */}
        {report?.accounts && report.accounts.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Account Balances</h2>
            </div>
            <div className="divide-y divide-gray-50">
              {report.accounts.map((a, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{a.name}</p>
                    <p className="text-xs text-gray-400">{a.institution_name} · {a.type}</p>
                  </div>
                  <p className={cn('text-sm font-bold', a.current_balance < 0 ? 'text-red-500' : 'text-gray-900')}>
                    {fmt2(a.current_balance)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Debt snapshot */}
        {report?.debts && report.debts.filter(d => !d.is_paid_off).length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Debt Balances</h2>
            </div>
            <div className="divide-y divide-gray-50">
              {report.debts.filter(d => !d.is_paid_off).map((d, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{d.name}</p>
                    <p className="text-xs text-gray-400">{(d.interest_rate * 100).toFixed(2)}% APR</p>
                  </div>
                  <p className="text-sm font-bold text-red-500">{fmt2(d.balance)}</p>
                </div>
              ))}
              <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
                <p className="text-sm font-semibold text-gray-700">Total Debt</p>
                <p className="text-sm font-bold text-red-600">{fmt(s?.total_debt ?? 0)}</p>
              </div>
            </div>
          </div>
        )}

        {/* Transactions */}
        {report?.transactions && report.transactions.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">Transactions ({report.transactions.length})</h2>
              <button onClick={downloadCSV} disabled={downloading}
                className="no-print flex items-center gap-1 text-xs text-blue-600 font-medium hover:text-blue-700">
                <Download size={12} /> Export CSV
              </button>
            </div>
            <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto print:max-h-none print:overflow-visible">
              {report.transactions.map((t, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-gray-800 truncate">{t.merchant_name || t.name}</p>
                    <p className="text-[10px] text-gray-400">{t.date} · {t.budget_category || t.account_name}</p>
                  </div>
                  <span className={cn('text-xs font-bold ml-3 shrink-0', t.amount < 0 ? 'text-green-600' : 'text-gray-900')}>
                    {t.amount < 0 ? '+' : ''}{fmt2(Math.abs(t.amount))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!report && (
          <div className="bg-white rounded-2xl shadow-sm p-12 text-center">
            <FileText size={40} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No data for this month</p>
          </div>
        )}
      </div>
    </div>
  )
}
