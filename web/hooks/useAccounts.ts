'use client'
import { useState, useEffect, useCallback } from 'react'
import { authHeaders } from '@/lib/auth'

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface Account {
  id: string; account_id: string; name: string; official_name: string | null;
  type: string; subtype: string | null; current_balance: number; available_balance: number | null;
  mask: string | null; institution_name: string | null
}

interface PlaidItem { id: string; institution_name: string; status: string }

export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [items, setItems] = useState<PlaidItem[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const headers = { ...authHeaders() }
      const [accts, itms] = await Promise.all([
        fetch(`${BASE}/api/v1/plaid/accounts`, { headers }).then(r => r.json()),
        fetch(`${BASE}/api/v1/plaid/items`, { headers }).then(r => r.json()),
      ])
      setAccounts(accts)
      setItems(itms)
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

  return { accounts, items, loading, refresh, syncAll, removeItem }
}
