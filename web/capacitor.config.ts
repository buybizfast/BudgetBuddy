import type { CapacitorConfig } from '@capacitor/cli'

// The native shell serves the static Next.js export from `out/`. Build it
// with `npm run build:native` (which sets CAPACITOR=1 so next.config emits
// a static export) and NEXT_PUBLIC_API_URL pointing at the deployed API.
const config: CapacitorConfig = {
  appId: 'com.budgetbuddy.app',
  appName: 'Budget Buddy',
  webDir: 'out',
  ios: {
    // Matches the web app's theme and the PWA manifest.
    backgroundColor: '#f8fafc',
  },
  android: {
    backgroundColor: '#f8fafc',
  },
}

export default config
