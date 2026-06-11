'use client'
import { useState } from 'react'
import { Building2, CreditCard, RefreshCw, Loader2, Trash2, TrendingUp } from 'lucide-react'
import { useAccounts } from '@/hooks/useAccounts'
import { PlaidLinkButton } from '@/components/PlaidLinkButton'
import { PageHeader } from '@/components/PageHeader'
import { cn } from '@/lib/utils'

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function AccountTypeIcon({ type, subtype }: { type: string; subtype: string | null }) {
  if (type === 'credit') return <CreditCard size={14} className="text-red-500" />
  if (type === 'investment' || type === 'brokerage') return <TrendingUp size={14} className="text-blue-500" />
  return <Building2 size={14} className="text-blue-600" />
}

export default function AccountsPage() {
  const { accounts, items, loading, refresh, syncAll, removeItem } = useAccounts()
  const [syncing, setSyncing] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const handleSyncAll = async () => {
    setSyncing(true)
    try { await syncAll() } finally { setSyncing(false) }
  }

  const handleRemove = async (id: string) => {
    setRemovingId(id)
    try { await removeItem(id) } finally { setRemovingId(null); setConfirmRemove(null) }
  }

  const byInstitution: Record<string, typeof accounts> = {}
  for (const acct of accounts) {
    const inst = acct.institution_name || 'Unknown Institution'
    if (!byInstitution[inst]) byInstitution[inst] = []
    byInstitution[inst].push(acct)
  }

  const assets = accounts
    .filter(a => a.type !== 'credit' && a.type !== 'loan')
    .reduce((s, a) => s + (a.current_balance ?? 0), 0)
  const debt = accounts
    .filter(a => a.type === 'credit' || a.type === 'loan')
    .reduce((s, a) => s + Math.abs(a.current_balance ?? 0), 0)
  const netWorth = assets - debt

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="animate-spin text-blue-600" size={32} />
    </div>
  )

  return (
    <div>
      <PageHeader
        title="Accounts"
        right={
          <div className="flex items-center gap-2">
            <button onClick={handleSyncAll} disabled={syncing}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl text-gray-700 transition-colors disabled:opacity-50 font-semibold">
              {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Sync All
            </button>
            <PlaidLinkButton onSuccess={refresh} />
          </div>
        }
      />
      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* Net Worth Summary */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <p className="text-xs text-gray-500 mb-1">Total Assets</p>
            <p className="text-xl font-bold text-blue-600">{fmt(assets)}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <p className="text-xs text-gray-500 mb-1">Total Debt</p>
            <p className="text-xl font-bold text-red-500">{fmt(debt)}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <p className="text-xs text-gray-500 mb-1">Net Worth</p>
            <p className={cn('text-xl font-bold', netWorth >= 0 ? 'text-gray-900' : 'text-red-500')}>{fmt(netWorth)}</p>
          </div>
        </div>

        {accounts.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm p-12 text-center">
            <Building2 size={40} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600 font-medium">No accounts connected</p>
            <p className="text-sm text-gray-400 mt-1">Click "Connect Bank" to link your first account.</p>
            <div className="mt-4 flex justify-center">
              <PlaidLinkButton onSuccess={refresh} />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(byInstitution).map(([institution, accts]) => {
              const item = items.find(i => i.institution_name === institution)
              return (
                <div key={institution} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
                    <div className="flex items-center gap-2">
                      <Building2 size={15} className="text-gray-500" />
                      <span className="font-semibold text-gray-900 text-sm">{institution}</span>
                      {item && (
                        <span className={cn('text-xs px-1.5 py-0.5 rounded-full', item.status === 'good' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-600')}>
                          {item.status}
                        </span>
                      )}
                    </div>
                    {item && (
                      <div>
                        {confirmRemove === item.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">Remove {institution}?</span>
                            <button onClick={() => handleRemove(item.id)} disabled={removingId === item.id}
                              className="text-xs px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded transition-colors disabled:opacity-50">
                              {removingId === item.id ? <Loader2 size={10} className="animate-spin inline" /> : 'Confirm'}
                            </button>
                            <button onClick={() => setConfirmRemove(null)} className="text-xs px-2 py-1 bg-white border border-gray-200 text-gray-700 rounded-xl transition-colors">
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmRemove(item.id)}
                            className="text-xs text-gray-400 hover:text-red-500 transition-colors flex items-center gap-1">
                            <Trash2 size={12} />Disconnect
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="divide-y divide-gray-100">
                    {accts.map(acct => (
                      <div key={acct.id} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
                        <div className="flex items-center gap-3 min-w-0">
                          <AccountTypeIcon type={acct.type} subtype={acct.subtype} />
                          <div className="min-w-0">
                            <p className="text-sm text-gray-900 font-medium truncate">{acct.name}</p>
                            <p className="text-xs text-gray-400">
                              {acct.official_name && acct.official_name !== acct.name ? `${acct.official_name} · ` : ''}
                              {acct.subtype && `${acct.subtype}`}
                              {acct.mask && ` ···${acct.mask}`}
                            </p>
                          </div>
                        </div>
                        <div className="text-right shrink-0 ml-4">
                          <p className={cn('text-sm font-semibold', acct.type === 'credit' ? 'text-red-500' : 'text-gray-900')}>
                            {fmt(acct.current_balance)}
                          </p>
                          {acct.available_balance !== null && acct.available_balance !== acct.current_balance && (
                            <p className="text-xs text-gray-400">{fmt(acct.available_balance)} avail.</p>
                          )}
                        </div>
                      </div>
                    ))}
                    <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50">
                      <span className="text-xs text-gray-400">Institution Total</span>
                      <span className="text-xs font-semibold text-gray-700">
                        {fmt(accts.reduce((s, a) => s + (a.current_balance ?? 0), 0))}
                      </span>
                    </div>
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
