'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, PiggyBank, Receipt, Building2, CalendarDays, BarChart2, Sparkles, CreditCard } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUpcomingBills } from '@/hooks/useUpcomingBills'

const tabs = [
  { href: '/',             label: 'Today',        icon: LayoutDashboard },
  { href: '/budget',       label: 'Budget',       icon: PiggyBank },
  { href: '/transactions', label: 'Transactions', icon: Receipt },
  { href: '/accounts',     label: 'Accounts',     icon: Building2 },
  { href: '/debt',         label: 'Debt',         icon: CreditCard },
  { href: '/calendar',     label: 'Calendar',     icon: CalendarDays, badge: true },
  { href: '/spending',     label: 'Insights',     icon: BarChart2 },
  { href: '/coach',        label: 'Coach',        icon: Sparkles },
]

export function BottomNav() {
  const pathname = usePathname()
  const { count } = useUpcomingBills(7)

  return (
    <nav aria-label="Main navigation" className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
      <div className="max-w-2xl mx-auto flex items-stretch h-16">
        {tabs.map(({ href, label, icon: Icon, badge }) => {
          const active = pathname === href || (href !== '/' && pathname.startsWith(href))
          const showBadge = badge && count > 0
          return (
            <Link key={href} href={href}
              aria-label={showBadge ? `${label} (${count} upcoming bill${count !== 1 ? 's' : ''})` : label}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center justify-center flex-1 gap-0.5 transition-colors relative',
                active ? 'text-blue-600' : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400'
              )}>
              <div className="relative">
                <Icon size={22} strokeWidth={active ? 2.5 : 1.8} aria-hidden="true" />
                {showBadge && (
                  <span aria-hidden="true" className="absolute -top-1 -right-1.5 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5">
                    {count > 9 ? '9+' : count}
                  </span>
                )}
              </div>
              <span aria-hidden="true" className={cn('text-[10px] font-medium', active ? 'text-blue-600' : 'text-gray-400 dark:text-gray-500')}>
                {label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
