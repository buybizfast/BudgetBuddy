import { Capacitor } from '@capacitor/core'
import { App, type URLOpenListenerEvent } from '@capacitor/app'
import { Browser } from '@capacitor/browser'

/** True inside the Capacitor iOS/Android shell, false in a normal browser. */
export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

/** Opens a URL in the system browser (SFSafariViewController / Chrome Custom
 *  Tab). Bank OAuth pages refuse to run inside an app webview, so Plaid
 *  Hosted Link has to happen out here. */
export async function openInSystemBrowser(url: string): Promise<void> {
  await Browser.open({ url, presentationStyle: 'popover' })
}

export async function closeSystemBrowser(): Promise<void> {
  try { await Browser.close() } catch {}
}

/** Resolves with the deep link the OS hands the app whose path matches
 *  `pathname` (e.g. "plaid-return" for budgetbuddy://plaid-return), or null
 *  if the user closes the system browser without ever reaching it. */
export function waitForDeepLink(pathname: string): Promise<URL | null> {
  return new Promise(resolve => {
    const urlHandle = App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
      let url: URL
      try { url = new URL(event.url) } catch { return }
      if (url.host !== pathname && url.pathname.replace(/^\/+/, '') !== pathname) return
      cleanup()
      resolve(url)
    })
    const closedHandle = Browser.addListener('browserFinished', () => {
      cleanup()
      resolve(null)
    })
    function cleanup() {
      urlHandle.then(h => h.remove())
      closedHandle.then(h => h.remove())
    }
  })
}
