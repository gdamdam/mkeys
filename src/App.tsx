import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useInstrument } from './app/useInstrument'
import { useKeyboardPlay } from './app/useKeyboardPlay'
import { nextTabIndex } from './app/tablist'
import { Surface } from './components/Surface/Surface'
import { TransportBar } from './components/TransportBar'
import { PatchPanel } from './components/PatchPanel'
import { Macros } from './components/Macros'
import { PresetPicker } from './components/PresetPicker'
import { PerformancePanel } from './components/PerformancePanel'
import './App.css'

type DrawerTab = 'sound' | 'perform'

const TABS: ReadonlyArray<{ id: DrawerTab; label: string }> = [
  { id: 'sound', label: 'Sound' },
  { id: 'perform', label: 'Perform' },
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
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  // WAI-ARIA tablist keyboard nav (§20): Left/Right/Home/End move selection and
  // focus together (roving tabindex), so the tabs are fully keyboard-operable.
  const onTabKeyDown = useCallback((e: ReactKeyboardEvent, index: number) => {
    const target = nextTabIndex(e.key, index, TABS.length)
    if (target === null) return
    e.preventDefault()
    setTab(TABS[target].id)
    tabRefs.current[target]?.focus()
  }, [])

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
          {TABS.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[i] = el
              }}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              // Roving tabindex: only the selected tab is in the tab order (§20).
              tabIndex={tab === t.id ? 0 : -1}
              className={`app__tab${tab === t.id ? ' is-active' : ''}`}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => onTabKeyDown(e, i)}
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

        {/* One panel per tab: the inactive ones are `hidden`, so assistive tech
            and the tab order skip them; only the active panel mounts content (§20). */}
        {TABS.map((t) => (
          <div
            key={t.id}
            className="app__panels"
            role="tabpanel"
            id={`panel-${t.id}`}
            aria-labelledby={`tab-${t.id}`}
            hidden={tab !== t.id}
            tabIndex={0}
          >
            {tab === t.id && t.id === 'sound' && (
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
            {tab === t.id && t.id === 'perform' && <PerformancePanel />}
          </div>
        ))}
      </aside>
    </div>
  )
}
