import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import './index.css'
import App from './App.tsx'
import { NativeLaunchSplash } from './components/NativeLaunchSplash.tsx'
const ReloadPrompt = lazy(() => import('./components/ReloadPrompt'))

import './locales/i18n'; // i18n 초기화

const isNativeApp = Capacitor.isNativePlatform()
const shouldEnablePwaPrompt = import.meta.env.PROD && !isNativeApp
const isLocalHost =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
const shouldShowLaunchSplash =
  isNativeApp ||
  (isLocalHost && new URLSearchParams(window.location.search).has('splash'))

function cleanupNativeServiceWorker() {
  if (!isNativeApp || typeof window === 'undefined') return

  const cleanupKey = 'buril:native-sw-cleaned:v1'

  void (async () => {
    const registrations =
      'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistrations() : []
    const cacheKeys = 'caches' in window ? await window.caches.keys() : []

    if (registrations.length === 0 && cacheKeys.length === 0) return

    await Promise.all([
      ...registrations.map((registration) => registration.unregister()),
      ...cacheKeys.map((key) => window.caches.delete(key)),
    ])

    if (window.sessionStorage.getItem(cleanupKey) === '1') return
    window.sessionStorage.setItem(cleanupKey, '1')
    window.location.reload()
  })().catch((error) => {
    console.warn('[PWA] Native service worker cleanup failed:', error)
  })
}

cleanupNativeServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      {shouldShowLaunchSplash ? <NativeLaunchSplash /> : null}
    </BrowserRouter>
    {shouldEnablePwaPrompt ? (
      <Suspense fallback={null}>
        <ReloadPrompt />
      </Suspense>
    ) : null}
  </StrictMode>,
)
