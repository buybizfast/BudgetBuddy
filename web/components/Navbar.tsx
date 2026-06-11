'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { PiggyBank, Landmark, Receipt, CreditCard, Target, LineChart, RefreshCw, CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils'

const navLinks = [
  { href: '/budget',       label: 'Budget',   icon: PiggyBank },
  { href: '/accounts',     label: 'Accounts', icon: Landmark },
  { href: '/transactions', label: 'Spending', icon: Receipt },
  { href: '/debt',         label: 'Debt',     icon: CreditCard },
  { href: '/goals',        label: 'Goals',    icon: Target },
  { href: '/spending',       label: 'Reports',       icon: LineChart },
  { href: '/subscriptions', label: 'Subscriptions', icon: RefreshCw },
  { href: '/calendar',      label: 'Calendar',      icon: CalendarDays },
]

export function Navbar() {
  const pathname = usePathname()
  return (
    <nav className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-[1400px] mx-auto px-4">
        <div className="flex items-center h-14 gap-6">
          <Link href="/budget" className="flex items-center gap-2 group shrink-0">
            <PiggyBank size={20} strokeWidth={2.5} className="text-blue-600 group-hover:text-blue-700 transition-colors" />
            <span className="font-bold text-gray-900 text-lg tracking-tight">
              Budget<span className="text-blue-600">Buddy</span>
            </span>
          </Link>
          <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-none">
            {navLinks.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(href + '/')
              return (
                <Link key={href} href={href} className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
                  active
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                )}>
                  <Icon size={13} />
                  {label}
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    </nav>
  )
}
