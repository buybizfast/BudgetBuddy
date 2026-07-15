'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { PiggyBank, Receipt, Building2, Target, CreditCard, CalendarDays, RefreshCw, BarChart2, ChevronRight, LogOut } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { clearToken } from '@/lib/auth'

const quickLinks = [
  { href: '/budget',        label: 'Budget',        icon: PiggyBank,    color: 'bg-blue-50 text-blue-600' },
  { href: '/transactions',  label: 'Transactions',  icon: Receipt,      color: 'bg-blue-50 text-blue-600' },
  { href: '/accounts',      label: 'Accounts',      icon: Building2,    color: 'bg-purple-50 text-purple-600' },
  { href: '/goals',         label: 'Goals',         icon: Target,       color: 'bg-amber-50 text-amber-600' },
  { href: '/debt',          label: 'Debt',          icon: CreditCard,   color: 'bg-red-50 text-red-500' },
  { href: '/subscriptions', label: 'Subscriptions', icon: RefreshCw,    color: 'bg-teal-50 text-teal-600' },
  { href: '/calendar',      label: 'Calendar',      icon: CalendarDays, color: 'bg-indigo-50 text-indigo-600' },
  { href: '/spending',      label: 'Insights',      icon: BarChart2,    color: 'bg-orange-50 text-orange-500' },
]

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

export default function TodayPage() {
  const router = useRouter()
  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  function logout() {
    clearToken()
    router.push('/login')
  }

  return (
    <div>
      <PageHeader
        title={<>{greeting}! 👋</>}
        subtitle={`${MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`}
        right={
          <button onClick={logout} aria-label="Sign out"
            className="flex items-center gap-1.5 text-blue-200 hover:text-white text-xs font-medium transition-colors">
            <LogOut size={15} />
            Sign out
          </button>
        }
      />

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-5">
        {/* Quick access grid */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 pt-4 pb-2">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Quick Access</h2>
          </div>
          <div className="grid grid-cols-4">
            {quickLinks.map(({ href, label, icon: Icon, color }) => (
              <Link key={href} href={href}
                className="flex flex-col items-center justify-center gap-1.5 py-4 px-2 hover:bg-gray-50 transition-colors border-t border-gray-100 first:border-l-0">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
                  <Icon size={18} strokeWidth={2} />
                </div>
                <span className="text-[10px] font-medium text-gray-600 text-center leading-tight">{label}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Get started */}
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <h2 className="text-base font-bold text-gray-900 mb-1">Get started</h2>
          <p className="text-sm text-gray-500 mb-4">Set up your budget and connect your accounts to track spending automatically.</p>
          <div className="space-y-2">
            {[
              { href: '/budget',   icon: PiggyBank,  color: 'bg-blue-100 text-blue-600',  label: 'Create your budget' },
              { href: '/accounts', icon: Building2,  color: 'bg-blue-100 text-blue-600',    label: 'Connect a bank account' },
              { href: '/goals',    icon: Target,     color: 'bg-amber-100 text-amber-600',  label: 'Add a savings goal' },
            ].map(({ href, icon: Icon, color, label }) => (
              <Link key={href} href={href} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
                    <Icon size={15} />
                  </div>
                  <span className="text-sm font-medium text-gray-900">{label}</span>
                </div>
                <ChevronRight size={16} className="text-gray-400" />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
