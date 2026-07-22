import { useCallback, useEffect, useState } from 'react'
import { useInstrument } from './app/useInstrument'
import { useKeyboardPlay } from './app/useKeyboardPlay'
import { Surface } from './components/Surface/Surface'
import { TransportBar } from './components/TransportBar'
import { PatchPanel } from './components/PatchPanel'
import { Macros } from './components/Macros'
import { PresetPicker } from './components/PresetPicker'
import { PerformancePanel } from './components/PerformancePanel'
import { SessionBar } from './components/SessionBar'
import './App.css'

type DrawerTab = 'sound' | 'perform' | 'session'

const TABS: ReadonlyArray<{ id: DrawerTab; label: string }> = [
  { id: 'sound', label: 'Sound' },
  { id: 'perform', label: 'Perform' },
  { id: 'session', label: 'Session' },
]

export default function App() {
  const instrument = useInstrument()
  const { started, start, panic } = instrument
  useKeyboardPlay(instrument)

  // Global Panic / All-Notes-Off shortcut (§13). Escape is never a musical
  // typing key, and we ignore it inside text fields, so it can neither fire
  // mid-word nor collide with the QWERTY play rows.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target
      if (
        t instanceof HTMLElement &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return
      }
      panic()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panic])

  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(true)
  const [tab, setTab] = useState<DrawerTab>('sound')

  const handleStart = useCallback(async () => {
    setStarting(true)
    setStartError(null)
    try {
      await start()
    } catch {
      setStartError("Audio didn't start. Tap again — some browsers need a second try.")
      setStarting(false)
    }
  }, [start])

  if (!started) {
    return (
      <main className="poweron">
        <div className="poweron__inner">
          <img
            className="poweron__mark"
            src={`${import.meta.env.BASE_URL}mkeys-mark.svg`}
            alt=""
            width={96}
            height={96}
          />
          <h1 className="poweron__wordmark">
            m<em>keys</em>
          </h1>
          <p className="poweron__hook">
            Touch a note. Bend into the next. Never leave the scale.
          </p>
          <button
            type="button"
            className="poweron__start"
            onClick={handleStart}
            disabled={starting}
          >
            {starting ? 'Starting…' : 'Start playing'}
          </button>
          {startError && (
            <p className="poweron__error" role="alert">
              {startError}
            </p>
          )}
          <p className="poweron__note">
            Runs entirely in your browser — no account, no upload. Sound begins on
            this tap.
          </p>
        </div>
      </main>
    )
  }

  return (
    <div className={`app${drawerOpen ? '' : ' app--focus'}`}>
      <TransportBar />

      <main className="app__stage">
        <Surface className="app__surface" />
      </main>

      {!drawerOpen && (
        <button
          type="button"
          className="app__drawer-toggle"
          onClick={() => setDrawerOpen(true)}
          aria-expanded={false}
          aria-controls="control-drawer"
        >
          Show controls
        </button>
      )}

      <aside
        id="control-drawer"
        className={`app__drawer${drawerOpen ? ' is-open' : ''}`}
        aria-hidden={!drawerOpen}
      >
        <div className="app__tabs" role="tablist" aria-label="Controls">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`app__tab${tab === t.id ? ' is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
          <button
            type="button"
            className="app__drawer-toggle"
            onClick={() => setDrawerOpen(false)}
            aria-expanded={true}
            aria-controls="control-drawer"
          >
            Hide controls
          </button>
        </div>

        <div className="app__panels" role="tabpanel">
          {tab === 'sound' && (
            <>
              <PresetPicker />
              {/* Synth sections have very uneven heights; a masonry column flow
                  packs them tightly instead of a staggered grid (see .soundrack). */}
              <div className="soundrack">
                <Macros />
                <PatchPanel />
              </div>
            </>
          )}
          {tab === 'perform' && <PerformancePanel />}
          {tab === 'session' && <SessionBar />}
        </div>
      </aside>
    </div>
  )
}
