/*
 * SessionBar — the session library + I/O. Save / load / delete local sessions,
 * export & import the session JSON, copy a shareable link, and capture the live
 * output to a WAV. Reads `savedSessions` and the transient capture flag from the
 * hook; all mutations go through the store actions.
 */
import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { IconButton, RecordIcon, ShareIcon, StopIcon } from './ui'
import { useInstrument } from '../app/useInstrument'
import { exportSessionJSON, importSessionJSON } from '../persistence/session'
import { sessionToShareUrl } from '../sharing/codec'
import './panels.css'

interface Toast {
  text: string
  warn: boolean
}

export function SessionBar() {
  const inst = useInstrument()
  const { session, savedSessions } = inst
  const [name, setName] = useState('')
  const [toast, setToast] = useState<Toast | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flash = (text: string, warn = false): void => {
    setToast({ text, warn })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2600)
  }

  const onSave = (): void => {
    const trimmed = name.trim()
    if (!trimmed) {
      flash('Name the session before saving.', true)
      return
    }
    void inst.saveSession(trimmed)
    setName('')
    flash(`Saved "${trimmed}".`)
  }

  const onExport = (): void => {
    const json = exportSessionJSON(session)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const safe = (session.name || 'mkeys-session').replace(/[^\w.-]+/g, '-')
    const a = document.createElement('a')
    a.href = url
    a.download = `${safe}.json`
    a.click()
    URL.revokeObjectURL(url)
    flash('Session exported.')
  }

  const onImportFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
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
    <div className="pgroup-wrap">
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
              if (e.key === 'Enter') onSave()
            }}
          />
          <button type="button" className="pbtn" onClick={onSave}>
            Save
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
                <button type="button" className="pbtn" onClick={() => void inst.loadSession(s.id)}>
                  Load
                </button>
                <button type="button" className="pbtn" onClick={() => void inst.deleteSession(s.id)}>
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
            <span className="pill pill--live">
              <span className="prec-dot" />
              Recording…
            </span>
          ) : (
            <span className="sessionrow__meta">Capture the live mix as a WAV file.</span>
          )}
        </div>
      </section>

      {toast ? (
        <p className={toast.warn ? 'ptoast ptoast--warn' : 'ptoast'} role="status">
          {toast.text}
        </p>
      ) : null}
    </div>
  )
}
