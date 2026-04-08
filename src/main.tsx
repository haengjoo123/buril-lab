import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
const ReloadPrompt = lazy(() => import('./components/ReloadPrompt'))

import './locales/i18n'; // i18n 초기화

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
    {import.meta.env.PROD ? (
      <Suspense fallback={null}>
        <ReloadPrompt />
      </Suspense>
    ) : null}
  </StrictMode>,
)
