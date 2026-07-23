import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Script from 'next/script'
import './globals.css'
import { BottomNav } from '@/components/BottomNav'
import { AuthGuard } from '@/components/AuthGuard'
import { ServiceWorkerRegistrar } from '@/components/ServiceWorkerRegistrar'
import { ThemeToggle } from '@/components/ThemeToggle'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'BudgetBuddy',
  description: 'Dave Ramsey-style zero-based budgeting',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'BudgetBuddy',
  },
  other: {
    'mobile-web-app-capable': 'yes',
    'theme-color': '#2563eb',
  },
}

const THEME_INIT_SCRIPT = `
(function() {
  try {
    var stored = localStorage.getItem('budgetbuddy-theme');
    var dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} bg-gray-100 dark:bg-slate-900 min-h-screen pb-20 transition-colors`}>
        <Script id="theme-init" strategy="beforeInteractive">{THEME_INIT_SCRIPT}</Script>
        <ServiceWorkerRegistrar />
        <a href="#main-content" className="skip-link">Skip to main content</a>
        <ThemeToggle className="fixed top-3 right-3 z-40 w-9 h-9 flex items-center justify-center rounded-full bg-white/90 dark:bg-gray-800/90 backdrop-blur shadow-md text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 transition-colors" />
        <AuthGuard>
          <main id="main-content" tabIndex={-1}>
            {children}
          </main>
        </AuthGuard>
      </body>
    </html>
  )
}
