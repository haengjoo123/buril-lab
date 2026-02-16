import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ReloadPrompt from './components/ReloadPrompt'

import './locales/i18n'; // i18n 초기화

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <ReloadPrompt />
  </StrictMode>,
)
