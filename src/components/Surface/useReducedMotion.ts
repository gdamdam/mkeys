import { useSyncExternalStore } from 'react'

/**
 * Subscribe to `prefers-reduced-motion`. When true the Surface disables the
 * glide trail, pad bloom and power-on shimmer, falling back to instant static
 * highlights — motion here is instrument feedback, so we drop it rather than
 * merely shorten it.
 */
const QUERY = '(prefers-reduced-motion: reduce)'

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mql = window.matchMedia(QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia(QUERY).matches
}

export function useReducedMotion(): boolean {
  // Server snapshot is always false — motion is opt-out, not opt-in.
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
