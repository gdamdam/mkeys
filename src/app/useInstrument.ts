/**
 * useInstrument — the single React entry point to the instrument.
 *
 * All real state and real-time machinery live in the module-singleton
 * {@link instrumentStore}; this hook is a thin `useSyncExternalStore` subscription
 * that hands components an immutable {@link Instrument} snapshot and re-renders
 * them when it changes. Audio, MIDI and scheduling never touch React — see
 * `store.ts`.
 */
import { useEffect, useSyncExternalStore } from 'react'
import type { Instrument } from '../components/instrument'
import { instrumentStore } from './store'

export function useInstrument(): Instrument {
  const instrument = useSyncExternalStore(
    instrumentStore.subscribe,
    instrumentStore.getSnapshot,
    instrumentStore.getSnapshot,
  )

  // Flush all notes when the tab is hidden or unloaded so nothing hangs. The
  // panic action is stable on the store, so this binds exactly once.
  useEffect(() => {
    const flush = (): void => instrumentStore.getSnapshot().panic()
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return instrument
}
