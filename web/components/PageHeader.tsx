import { ReactNode } from 'react'

interface PageHeaderProps {
  title: ReactNode
  subtitle?: string
  left?: ReactNode
  right?: ReactNode
}

export function PageHeader({ title, subtitle, left, right }: PageHeaderProps) {
  return (
    <header className="bg-blue-600 px-4 pt-5 pb-5">
      <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {left}
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-white leading-tight truncate">{title}</h1>
            {subtitle && <p className="text-blue-200 text-xs mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
    </header>
  )
}
