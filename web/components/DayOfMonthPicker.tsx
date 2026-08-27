'use client'
import { CalendarDays } from 'lucide-react'

interface Props {
  id?: string
  /** Day of month as a string, '' when unset. */
  value: string
  onChange: (day: string) => void
  placeholder?: string
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

/** Picks a recurring day-of-month by opening a real calendar rather than
 *  making people type a number. The date chosen is only used for its day —
 *  the month and year are ignored, since these dates repeat monthly. */
export function DayOfMonthPicker({ id, value, onChange, placeholder }: Props) {
  const day = value ? parseInt(value, 10) : NaN

  // Anchor the calendar on the current month so a picked day maps to the
  // month the user is looking at.
  const today = new Date()
  const dateValue = !isNaN(day)
    ? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(Math.min(day, 28)).padStart(2, '0')}`
    : ''

  return (
    <div className="space-y-1">
      <div className="relative">
        <input
          id={id}
          type="date"
          value={dateValue}
          onChange={e => {
            if (!e.target.value) { onChange(''); return }
            // Parse as local time — 'YYYY-MM-DD' alone is treated as UTC and
            // can land on the previous day in negative-offset timezones.
            const picked = new Date(e.target.value + 'T00:00:00')
            onChange(String(picked.getDate()))
          }}
          className="w-full bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm rounded-xl pl-3 pr-9 py-2 border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <CalendarDays size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none" />
      </div>
      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        {!isNaN(day)
          ? `Repeats the ${ordinal(day)} of every month`
          : placeholder ?? 'Pick any date — only the day of the month is used'}
      </p>
    </div>
  )
}
