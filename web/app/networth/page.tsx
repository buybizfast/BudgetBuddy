'use client'
import { useState, useEffect, useCallback } from 'react'
import { TrendingUp, TrendingDown, Loader2, Camera } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'
import { apiFetch } from '@/lib/api'

interface Snapshot {
  year: number
  month: number
  assets: number
  liabilities: number
  net_worth: number
}

interface Current {
  year: number
  month: number
  assets: number
  liabilities: number
  net_worth: number
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

function NetWorthChart({ snapshots }: { snapshots: Snapshot[] }) {
  const [hovered, setHovered] = useState<number | null>(null)

  if (snapshots.length < 2) return (
    <div className="flex flex-col items-center justify-center h-48 text-gray-400 text-sm">
      <TrendingUp size={32} className="mb-2 opacity-30" />
      Save at least 2 snapshots to see your chart
    </div>
  )

  const W = 600, H = 200, PAD = { top: 16, right: 16, bottom: 32, left: 56 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  const values = snapshots.map(s => s.net_worth)
  const minVal = Math.min(...values)
  const maxVal = Math.max(...values)
  const range = maxVal - minVal || 1
  const padded = range * 0.15

  const toX = (i: number) => PAD.left + (i / (snapshots.length - 1)) * innerW
  const toY = (v: number) => PAD.top + innerH - ((v - minVal + padded) / (range + padded * 2)) * innerH

  const points = snapshots.map((s, i) => `${toX(i)},${toY(s.net_worth)}`).join(' ')

  // Y axis ticks
  const tickCount = 4
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const v = minVal + (range / (tickCount - 1)) * i
    return { v, y: toY(v) }
  })

  const isPositive = snapshots[snapshots.length - 1].net_worth >= snapshots[0].net_worth

  return (
    <div className="relative w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ minWidth: 300 }}>
        <defs>
          <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={isPositive ? '#3b82f6' : '#ef4444'} stopOpacity="0.18" />
            <stop offset="100%" stopColor={isPositive ? '#3b82f6' : '#ef4444'} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={t.y} y2={t.y} stroke="#f1f5f9" strokeWidth="1" />
            <text x={PAD.left - 6} y={t.y + 4} textAnchor="end" fontSize="10" fill="#94a3b8">
              {fmt(t.v)}
            </text>
          </g>
        ))}

        {/* Zero line */}
        {minVal < 0 && maxVal > 0 && (
          <line x1={PAD.left} x2={W - PAD.right} y1={toY(0)} y2={toY(0)}
            stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 4" />
        )}

        {/* Area fill */}
        <polygon
          points={`${PAD.left},${toY(minVal - padded)} ${points} ${W - PAD.right},${toY(minVal - padded)}`}
          fill="url(#nwGrad)"
        />

        {/* Line */}
        <polyline points={points} fill="none"
          stroke={isPositive ? '#3b82f6' : '#ef4444'} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

        {/* Points + hover zones */}
        {snapshots.map((s, i) => (
          <g key={i}>
            <rect
              x={toX(i) - 20} y={PAD.top} width={40} height={innerH}
              fill="transparent"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            />
            {(hovered === i || snapshots.length <= 6) && (
              <>
                <circle cx={toX(i)} cy={toY(s.net_worth)} r={4}
                  fill={isPositive ? '#3b82f6' : '#ef4444'} stroke="white" strokeWidth="2" />
                {hovered === i && (
                  <g>
                    <rect x={Math.min(toX(i) - 48, W - PAD.right - 96)} y={toY(s.net_worth) - 36}
                      width={96} height={28} rx={6} fill="#1e293b" />
                    <text x={Math.min(toX(i), W - PAD.right - 48)} y={toY(s.net_worth) - 18}
                      textAnchor="middle" fontSize="11" fill="white" fontWeight="600">
                      {fmt(s.net_worth)}
                    </text>
                  </g>
                )}
              </>
            )}
            {/* X labels */}
            <text x={toX(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="#94a3b8">
              {MONTHS[s.month - 1]} {String(s.year).slice(2)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

export default function NetWorthPage() {
  const [current, setCurrent] = useState<Current | null>(null)
  const [history, setHistory] = useState<Snapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedThisMonth, setSavedThisMonth] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [cur, hist] = await Promise.all([
        apiFetch<Current>('/api/v1/networth/current'),
        apiFetch<Snapshot[]>('/api/v1/networth/history'),
      ])
      setCurrent(cur)
      setHistory(hist)
      const now = new Date()
      setSavedThisMonth(hist.some(s => s.year === now.getFullYear() && s.month === now.getMonth() + 1))
    } catch {} finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const saveSnapshot = async () => {
    setSaving(true)
    try {
      await apiFetch('/api/v1/networth/snapshot', { method: 'POST' })
      await fetchData()
    } catch {} finally { setSaving(false) }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="animate-spin text-blue-600" size={32} />
    </div>
  )

  const now = new Date()
  const change = history.length >= 2
    ? history[history.length - 1].net_worth - history[history.length - 2].net_worth
    : null
  const isPositive = current ? current.net_worth >= 0 : true
  const trend = change !== null ? (change >= 0 ? 'up' : 'down') : null

  return (
    <div>
      <PageHeader title="Net Worth" subtitle="Assets minus liabilities over time" />

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">

        {/* Current net worth card */}
        {current && (
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs text-gray-400 mb-1">Current Net Worth</p>
                <p className={cn('text-3xl font-bold', isPositive ? 'text-gray-900' : 'text-red-500')}>
                  {fmt(current.net_worth)}
                </p>
                {trend && change !== null && (
                  <div className={cn('flex items-center gap-1 mt-1 text-xs font-medium',
                    trend === 'up' ? 'text-green-600' : 'text-red-500')}>
                    {trend === 'up' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    {change >= 0 ? '+' : ''}{fmt(change)} vs last snapshot
                  </div>
                )}
              </div>
              <button
                onClick={saveSnapshot}
                disabled={saving}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors',
                  savedThisMonth
                    ? 'bg-green-50 text-green-700 hover:bg-green-100'
                    : 'bg-blue-600 text-white hover:bg-blue-700',
                  saving && 'opacity-50'
                )}
              >
                <Camera size={13} />
                {saving ? 'Saving…' : savedThisMonth ? '✓ Saved' : 'Save Snapshot'}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-green-50 rounded-xl p-3">
                <p className="text-xs text-green-600 font-medium mb-0.5">Total Assets</p>
                <p className="text-lg font-bold text-green-700">{fmt(current.assets)}</p>
                <p className="text-xs text-green-500 mt-0.5">Bank accounts + savings</p>
              </div>
              <div className="bg-red-50 rounded-xl p-3">
                <p className="text-xs text-red-500 font-medium mb-0.5">Total Liabilities</p>
                <p className="text-lg font-bold text-red-600">{fmt(current.liabilities)}</p>
                <p className="text-xs text-red-400 mt-0.5">Outstanding debt</p>
              </div>
            </div>
          </div>
        )}

        {/* Chart */}
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700">History</h2>
            <span className="text-xs text-gray-400">{history.length} snapshot{history.length !== 1 ? 's' : ''}</span>
          </div>
          <NetWorthChart snapshots={history} />

          {history.length === 0 && (
            <div className="text-center py-4">
              <p className="text-xs text-gray-400">Hit "Save Snapshot" each month to track your progress over time.</p>
            </div>
          )}
        </div>

        {/* Snapshot history table */}
        {history.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Snapshot History</h2>
            </div>
            <div className="divide-y divide-gray-50">
              {[...history].reverse().map((s, i) => {
                const prev = history[history.length - 2 - i]
                const delta = prev ? s.net_worth - prev.net_worth : null
                return (
                  <div key={`${s.year}-${s.month}`} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">
                        {MONTHS[s.month - 1]} {s.year}
                      </p>
                      <p className="text-xs text-gray-400">
                        Assets {fmt(s.assets)} · Debt {fmt(s.liabilities)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={cn('text-sm font-bold', s.net_worth < 0 ? 'text-red-500' : 'text-gray-900')}>
                        {fmt(s.net_worth)}
                      </p>
                      {delta !== null && (
                        <p className={cn('text-xs font-medium', delta >= 0 ? 'text-green-600' : 'text-red-500')}>
                          {delta >= 0 ? '+' : ''}{fmt(delta)}
                        </p>
                      )}
                    </div>
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
