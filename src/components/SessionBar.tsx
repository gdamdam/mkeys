/*
 * SessionBar — the session library + I/O, presented as a header dropdown menu
 * (◆ Session). Save / load / delete local sessions, export & import the session
 * JSON, copy a shareable link, and capture the live output to a WAV. Reads
 * `savedSessions` and the transient capture flag from the hook; all mutations go
 * through the store actions.
 */
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { IconButton, RecordIcon, ShareIcon, StopIcon } from './ui'
import { useInstrument } from '../app/useInstrument'
import { exportSessionJSON, importSessionJSON } from '../persistence/session'
import { sessionToShareUrl } from '../sharing/codec'
import { MAX_JSON_IMPORT_BYTES } from '../limits'
import './panels.css'


interface Toast {
  text: string
  warn: boolean
}

/** Format seconds as m:ss for the recording readout. */
function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function SessionBar() {
  const inst = useInstrument()
  const { session, savedSessions } = inst
  const [name, setName] = useState('')
  const [toast, setToast] = useState<Toast | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const menuRef = useRef<HTMLDetailsElement>(null)

  // Dismiss the dropdown on an outside pointer-down, matching the other header
  // menus (a native <details> only closes via its own summary otherwise).
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const t = e.target
      if (t instanceof Node && !menuRef.current?.contains(t)) {
        menuRef.current?.removeAttribute('open')
      }
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [])

  const closeMenu = (): void => menuRef.current?.removeAttribute('open')

  const flash = (text: string, warn = false): void => {
    setToast({ text, warn })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2600)
  }

  const onSave = async (): Promise<void> => {
    if (busy) return // debounce: no duplicate saves from rapid clicks (§15)
    const trimmed = name.trim()
    if (!trimmed) {
      flash('Name the session before saving.', true)
      return
    }
    setBusy(true)
    // Announce success only after the write actually commits; on failure keep
    // the typed name so the user can retry (§15).
    const res = await inst.saveSession(trimmed)
    setBusy(false)
    if (res.ok) {
      setName('')
      flash(`Saved "${trimmed}".`)
    } else {
      flash(res.error, true)
    }
  }

  const onExport = (): void => {
    const json = exportSessionJSON(session)
    // A safe, non-empty filename even if the name is all punctuation/unicode (§22).
    const cleaned = (session.name || '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')
    const safe = cleaned.slice(0, 64) || 'mkeys-session'
    try {
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${safe}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Revoke after a browser-safe delay, not synchronously, so the download
      // isn't cancelled before it starts in some browsers (§22).
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      flash('Session exported.')
    } catch {
      flash('Export failed — could not create the download.', true)
    }
  }

  const onImportFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    // Reject an oversized file before reading it into memory (§16).
    if (file.size > MAX_JSON_IMPORT_BYTES) {
      flash(`That file is too large (max ${Math.round(MAX_JSON_IMPORT_BYTES / 1024 / 1024)} MB).`, true)
      return
    }
    const text = await file.text()
    const imported = importSessionJSON(text)
    if (!imported) {
      flash("That file isn't valid session JSON.", true)
      return
    }
    inst.applySession(imported)
    flash(`Loaded "${imported.name}".`)
  }

  const onShare = async (): Promise<void> => {
    const url = sessionToShareUrl(session)
    try {
      await navigator.clipboard.writeText(url)
      flash('Share link copied to clipboard.')
    } catch {
      flash('Copy failed — check clipboard permission.', true)
    }
  }

  const onMaster = (): void => {
    if (inst.masterRecording) void inst.stopMasterRecord()
    else void inst.startMasterRecord()
  }

  return (
    <details className="session-menu" ref={menuRef}>
      <summary className="session-menu__button" aria-label="Open session menu">
        ◆ Session
      </summary>
      <div className="session-menu__sheet pgroup-wrap">
      {/* Save + library */}
      <section className="pgroup">
        <span className="pgroup__title eyebrow">Sessions</span>
        <div className="transport__row">
          <input
            className="pinput"
            type="text"
            value={name}
            placeholder="Session name"
            aria-label="Session name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onSave()
            }}
          />
          <button type="button" className="pbtn" onClick={() => void onSave()} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>

        {savedSessions.length === 0 ? (
          <p className="pempty">No saved sessions yet. Save one to build your library.</p>
        ) : (
          <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {savedSessions.map((s) => (
              <li key={s.id} className="sessionrow">
                <span className="sessionrow__name">{s.name}</span>
                {s.updatedAt ? (
                  <span className="sessionrow__meta">
                    {new Date(s.updatedAt).toLocaleDateString()}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="pbtn"
                  onClick={() => {
                    void inst.loadSession(s.id).then((r) => {
                      if (r.ok) {
                        flash(`Loaded "${s.name}".`)
                        closeMenu()
                      } else flash(r.error, true)
                    })
                  }}
                >
                  Load
                </button>
                <button
                  type="button"
                  className="pbtn"
                  onClick={() => {
                    void inst.deleteSession(s.id).then((r) => {
                      if (!r.ok) flash(r.error, true)
                    })
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* I/O */}
      <section className="pgroup">
        <span className="pgroup__title eyebrow">Share &amp; export</span>
        <div className="transport__row">
          <IconButton label="Copy share link" onClick={() => void onShare()}>
            <ShareIcon />
          </IconButton>
          <button type="button" className="pbtn" onClick={onExport}>
            Export JSON
          </button>
          <button type="button" className="pbtn" onClick={() => fileRef.current?.click()}>
            Import JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(e) => void onImportFile(e)}
          />
        </div>
      </section>

      {/* Master capture */}
      <section className="pgroup">
        <span className="pgroup__title eyebrow">Record output</span>
        <div className="transport__row">
          <IconButton
            label={inst.masterRecording ? 'Stop recording' : 'Record output to WAV'}
            active={inst.masterRecording}
            onClick={onMaster}
          >
            {inst.masterRecording ? <StopIcon /> : <RecordIcon />}
          </IconButton>
          {inst.masterRecording ? (
            <span className="pill pill--live" role="status" aria-live="polite">
              <span className="prec-dot" />
              {fmtClock(inst.masterRecordSeconds)} / {fmtClock(inst.masterRecordMaxSeconds)}
            </span>
          ) : (
            <span className="sessionrow__meta">
              Capture the live mix as a WAV file (up to {Math.round(inst.masterRecordMaxSeconds / 60)} min).
            </span>
          )}
        </div>
      </section>

      {/* Output latency — an honest readout of the platform round-trip floor. */}
      <section className="pgroup">
        <span className="pgroup__title eyebrow">Output latency</span>
        <div className="transport__row">
          <span
            className="pill"
            title="The browser adds a round-trip delay (hardware buffer + base/output latency), typically 10–30 ms. This is a platform floor the app can't lower. For zero-latency monitoring of a live instrument, use your interface's direct/hardware monitoring for the dry signal."
          >
            ≈ {inst.latencyMs != null ? Math.round(inst.latencyMs) : '—'} ms round-trip
          </span>
        </div>
      </section>

      {toast ? (
        <p className={toast.warn ? 'ptoast ptoast--warn' : 'ptoast'} role="status">
          {toast.text}
        </p>
      ) : null}
      </div>
    </details>
  )
}
