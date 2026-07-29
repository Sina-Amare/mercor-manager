import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted so the app renders identically offline and on connections where
// fonts.googleapis.com is slow or blocked — which is most of the team's.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource-variable/vazirmatn'
import './index.css'
import App from './App'
import AppErrorBoundary from './components/shared/AppErrorBoundary'
import { installChunkLoadRecovery, scheduleRecoveryUrlCleanup } from './utils/pageRecovery'

installChunkLoadRecovery()
scheduleRecoveryUrlCleanup()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
