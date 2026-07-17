'use client'
import { useState, useEffect } from 'react'
import { apiFetch } from '@/lib/api'

export interface UpcomingBill {
  merchant: string
  amount: number
  due_date: string
  days_until: number
}

export function useUpcomingBills(daysAhead = 7) {
  const [bills, setBills] = useState<UpcomingBill[]>([])
  const [count, setCount] = useState(0)

  useEffect(() => {
    apiFetch<UpcomingBill[]>(`/api/v1/bills/upcoming?days_ahead=${daysAhead}`)
      .then(data => { setBills(data); setCount(data.length) })
      .catch(() => {})
  }, [daysAhead])

  return { bills, count }
}
