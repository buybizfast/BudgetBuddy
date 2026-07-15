import { authHeaders, clearToken } from '@/lib/auth'

export const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init?.headers ?? {}) },
  })
  if (res.status === 401) { clearToken(); window.location.href = '/login' }
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}
