'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { authHeaders, clearToken } from '@/lib/auth'

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const WS_BASE = BASE.replace(/^http/, 'ws')

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init?.headers ?? {}) },
  })
  if (res.status === 401) { clearToken(); window.location.href = '/login' }
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export interface BudgetCategory {
  id: string; name: string; budgeted: number; spent: number; remaining: number; sort_order: number
  cost_type: 'fixed' | 'variable'
}
export interface BudgetGroup {
  id: string; name: string; budgeted: number; spent: number; remaining: number; sort_order: number; categories: BudgetCategory[]
}
export interface BudgetMonth {
  id: string; year: number; month: number; total_income: number; total_budgeted: number; total_spent: number; left_to_budget: number; groups: BudgetGroup[]
  total_fixed_budgeted: number; total_fixed_spent: number; total_variable_budgeted: number; total_variable_spent: number
}
export interface LiveTransaction {
  name: string; merchant_name: string | null; amount: number; date: string | null; auto_categorized: boolean
}

export function useBudget(year: number, month: number) {
  const [budget, setBudget] = useState<BudgetMonth | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncStatus, setSyncStatus] = useState({ last_synced_at: null as string | null, last_added: 0, syncing: false })
  const [recentTransactions, setRecentTransactions] = useState<LiveTransaction[]>([])
  const wsRef = useRef<WebSocket | null>(null)

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<BudgetMonth>(`/api/v1/budget/month/${year}/${month}`)
      setBudget(data)
      setError(null)
    } catch (e: any) {
      setError(e.message)
    }
  }, [year, month])

  useEffect(() => {
    setLoading(true)
    refresh().finally(() => setLoading(false))
  }, [refresh])

  useEffect(() => {
    apiFetch<typeof syncStatus>('/api/v1/budget/sync-status').then(setSyncStatus).catch(() => {})
  }, [])

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>
    const connect = () => {
      const ws = new WebSocket(`${WS_BASE}/ws`)
      wsRef.current = ws
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data)
          if (msg.type === 'budget.update') {
            setSyncStatus(s => ({ ...s, last_synced_at: msg.data.synced_at, last_added: msg.data.added, syncing: false }))
            setRecentTransactions(prev => [...(msg.data.new_transactions || []), ...prev].slice(0, 20))
            refresh()
          }
        } catch {}
      }
      ws.onclose = () => { reconnectTimer = setTimeout(connect, 3000) }
    }
    connect()
    return () => { clearTimeout(reconnectTimer); wsRef.current?.close() }
  }, [refresh])

  const updateIncome = async (income: number) => {
    if (!budget) return
    await apiFetch(`/api/v1/budget/month/${budget.id}/income`, { method: 'PATCH', body: JSON.stringify({ income }) })
    await refresh()
  }

  const updateCategory = async (id: string, budgeted: number) => {
    await apiFetch(`/api/v1/budget/categories/${id}`, { method: 'PATCH', body: JSON.stringify({ budgeted }) })
    await refresh()
  }

  const renameCategory = async (id: string, name: string) => {
    await apiFetch(`/api/v1/budget/categories/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) })
    await refresh()
  }

  const updateCategoryCostType = async (id: string, costType: 'fixed' | 'variable') => {
    await apiFetch(`/api/v1/budget/categories/${id}`, { method: 'PATCH', body: JSON.stringify({ cost_type: costType }) })
    await refresh()
  }

  const deleteCategory = async (id: string) => {
    await apiFetch(`/api/v1/budget/categories/${id}`, { method: 'DELETE' })
    await refresh()
  }

  const addCategory = async (groupId: string, name: string) => {
    await apiFetch(`/api/v1/budget/groups/${groupId}/categories`, { method: 'POST', body: JSON.stringify({ name }) })
    await refresh()
  }

  const syncNow = async () => {
    setSyncStatus(s => ({ ...s, syncing: true }))
    try {
      await apiFetch('/api/v1/budget/sync-now', { method: 'POST' })
      await refresh()
    } finally {
      setSyncStatus(s => ({ ...s, syncing: false }))
    }
  }

  const autoCategorize = async () => {
    await apiFetch(`/api/v1/budget/auto-categorize/${year}/${month}`, { method: 'POST' })
    await refresh()
  }

  return { budget, loading, error, refresh, updateIncome, updateCategory, renameCategory, updateCategoryCostType, deleteCategory, addCategory, syncStatus, syncNow, autoCategorize, recentTransactions }
}
