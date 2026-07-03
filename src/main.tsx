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

// Register the service worker for offline use. Best-effort: a failure (e.g. an
// unsupported browser or a blocked registration) must never break the app.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
  })
}
