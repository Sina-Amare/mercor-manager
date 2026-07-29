import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
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
