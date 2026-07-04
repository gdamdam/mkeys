import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
// Self-hosted character fonts (no Google CDN — offline + privacy-safe):
// Fraunces (warm display serif) for identity, Space Grotesk for UI chrome,
// Space Mono for the musical readouts.
import '@fontsource-variable/fraunces/index.css'
import '@fontsource-variable/space-grotesk/index.css'
import '@fontsource/space-mono/400.css'
import '@fontsource/space-mono/700.css'
import './styles/global.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('mkeys: #root element not found')

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register the service worker for offline use — production builds only.
// Best-effort: a failure (e.g. an unsupported browser or a blocked
// registration) must never break the app.
//
// In dev the SW must not run at all: its cache-first fetch handler pins stale
// modules, and the localhost:5173 origin is shared by every Vite project, so a
// worker registered here can serve another app's cached files (and vice
// versa). Also unregister any previously installed worker so an existing dev
// profile heals itself on the next load.
if ('serviceWorker' in navigator) {
  if (import.meta.env.DEV) {
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => {
        for (const reg of regs) void reg.unregister()
      })
      .catch(() => {})
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
    })
  }
}
