'use client'
import { useState, useEffect, useCallback } from 'react'
import { authHeaders } from '@/lib/auth'

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface Account {
  id: string; account_id: string; name: string; official_name: string | null;
  type: string; subtype: string | null; current_balance: number; available_balance: number | null;
  mask: string | null; institution_name: string | null
}

interface PlaidItem { id: string; institution_name: string; status: string; last_sync_error: string | null }

interface NetWorth { assets: number; liabilities: number; net_worth: number }

export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [items, setItems] = useState<PlaidItem[]>([])
  // Assets/liabilities totals come from /api/v1/networth/current — the same
  // DebtAccount-based source the Net Worth and Debt pages use — instead of
  // being recomputed here from raw Plaid balances, which drift out of sync
  // whenever a debt is manually paid, edited, or created without a linked
  // bank account.
  const [netWorth, setNetWorth] = useState<NetWorth>({ assets: 0, liabilities: 0, net_worth: 0 })
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const headers = { ...authHeaders() }
      const [accts, itms, nw] = await Promise.all([
        fetch(`${BASE}/api/v1/plaid/accounts`, { headers }).then(r => r.json()),
        fetch(`${BASE}/api/v1/plaid/items`, { headers }).then(r => r.json()),
        fetch(`${BASE}/api/v1/networth/current`, { headers }).then(r => r.json()),
      ])
      setAccounts(accts)
      setItems(itms)
      setNetWorth({ assets: nw.assets ?? 0, liabilities: nw.liabilities ?? 0, net_worth: nw.net_worth ?? 0 })
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const syncAll = async () => {
    await fetch(`${BASE}/api/v1/plaid/sync-all`, { method: 'POST', headers: { ...authHeaders() } })
    await refresh()
  }

  const removeItem = async (id: string) => {
    await fetch(`${BASE}/api/v1/plaid/items/${id}`, { method: 'DELETE', headers: { ...authHeaders() } })
    await refresh()
  }

  return { accounts, items, netWorth, loading, refresh, syncAll, removeItem }
}
