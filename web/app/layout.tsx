import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { BottomNav } from '@/components/BottomNav'
import { AuthGuard } from '@/components/AuthGuard'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Budget Buddy',
  description: 'Dave Ramsey-style zero-based budgeting',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-gray-100 min-h-screen pb-20`}>
        <a href="#main-content" className="skip-link">Skip to main content</a>
        <AuthGuard>
          <main id="main-content" tabIndex={-1}>
            {children}
          </main>
        </AuthGuard>
      </body>
    </html>
  )
}
