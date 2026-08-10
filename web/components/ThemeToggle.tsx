'use client'
import { useEffect, useState } from 'react'
import { Sun, Moon } from 'lucide-react'
import { getStoredTheme, applyTheme, type Theme } from '@/lib/theme'

export function ThemeToggle({ className }: { className?: string }) {
  // Read the actual DOM state (set synchronously by the pre-hydration
  // script) instead of a separately-tracked default, so the first click
  // always toggles from the theme that's really showing.
  const [theme, setTheme] = useState<Theme>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  )

  useEffect(() => {
    setTheme(getStoredTheme())
  }, [])

  const toggle = () => {
    const current: Theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light'
    const next: Theme = current === 'dark' ? 'light' : 'dark'
    setTheme(next)
    applyTheme(next)
  }

  return (
    <button
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className={className ?? 'w-9 h-9 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors'}
    >
      {theme === 'dark' ? <Moon size={16} aria-hidden="true" /> : <Sun size={16} aria-hidden="true" />}
    </button>
  )
}
