/*
 * TuningControls — the microtuning control, sitting in the top bar right beside
 * KEY and SCALE because it is the same kind of "which pitches" decision. Pick a
 * built-in scale, adjust the tonic reference pitch, or import a Scala `.scl`
 * scale / `.kbm` keyboard map.
 *
 * The store owns all tuning state (setTuning / setTonic / importSclFile /
 * importKbmFile); this is a thin control surface. Selecting "12-TET (standard)"
 * clears the tuning back to the click-identical default. When a tuning is active
 * it overrides SCALE (the diatonic mode is bypassed — see harmony/tuning.ts), so
 * placing it next to SCALE keeps that relationship legible.
 */
import { useRef, useState } from 'react'
import { Select } from './ui'
import type { SelectOption } from './ui'
import { useInstrument } from '../app/useInstrument'
import { BUILTIN_PORTABLE_TUNINGS, DEFAULT_TONIC_HZ } from '../harmony/tuning'

/** Sentinel Select value for "no tuning" — plain 12-TET. */
const TET_VALUE = ' 12tet'

export function TuningControls() {
  const inst = useInstrument()
  const tuning = inst.session.tuning ?? null
  const sclRef = useRef<HTMLInputElement>(null)
  const kbmRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  // Local draft so the tonic field doesn't retune (releaseAll) on every keystroke;
  // committed on blur / Enter.
  const [tonicDraft, setTonicDraft] = useState<string | null>(null)

  const options: SelectOption<string>[] = [
    { value: TET_VALUE, label: '12-TET (standard)', group: 'Standard' },
    ...BUILTIN_PORTABLE_TUNINGS.map((t) => ({ value: t.name, label: t.name, group: 'Built-in' })),
  ]
  // An imported .scl carries a name not in the library; surface it so the control
  // reflects the active scale instead of falling back to the placeholder.
  if (tuning && !BUILTIN_PORTABLE_TUNINGS.some((t) => t.name === tuning.name)) {
    options.push({ value: tuning.name, label: `${tuning.name} (imported)`, group: 'Imported' })
  }

  const onTuningChange = (value: string): void => {
    setError(null)
    if (value === TET_VALUE) {
      inst.setTuning(null)
      return
    }
    const builtin = BUILTIN_PORTABLE_TUNINGS.find((t) => t.name === value)
    if (!builtin) return
    // Keep the current tonic across preset changes (else each preset snaps to its
    // own default reference pitch).
    inst.setTuning(tuning ? { ...builtin, tonicHz: tuning.tonicHz } : builtin)
  }

  const commitTonic = (): void => {
    if (tonicDraft === null) return
    const hz = Number(tonicDraft)
    if (Number.isFinite(hz) && hz > 0) inst.setTonic(hz)
    setTonicDraft(null)
  }

  const onImportScl = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    try {
      inst.importSclFile(await file.text())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "That file isn't a valid .scl scale.")
    }
  }

  const onImportKbm = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      inst.importKbmFile(await file.text())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "That file isn't a valid .kbm keyboard map.")
    }
  }

  const tonicValue = tonicDraft ?? String((tuning?.tonicHz ?? DEFAULT_TONIC_HZ).toFixed(2))

  return (
    <div className="transport__block tuningstrip">
      <div className="transport__row tuningstrip__row">
        <Select label="Tuning" options={options} value={tuning ? tuning.name : TET_VALUE} onChange={onTuningChange} />
        <label className="tuningstrip__tonic">
          <span className="eyebrow">Tonic</span>
          <input
            className="pinput pinput--hz"
            type="number"
            inputMode="decimal"
            min={20}
            max={4000}
            step={0.01}
            value={tonicValue}
            disabled={!tuning}
            aria-label="Tonic (Hz)"
            onChange={(e) => setTonicDraft(e.target.value)}
            onBlur={commitTonic}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
          />
        </label>
        <button type="button" className="pbtn" onClick={() => sclRef.current?.click()}>
          .scl
        </button>
        <button type="button" className="pbtn" onClick={() => kbmRef.current?.click()}>
          .kbm
        </button>
        <input ref={sclRef} type="file" accept=".scl,text/plain" className="sr-only" onChange={(e) => void onImportScl(e)} />
        <input ref={kbmRef} type="file" accept=".kbm,text/plain" className="sr-only" onChange={(e) => void onImportKbm(e)} />
      </div>
      {error ? (
        <p className="sessionrow__meta" role="alert" style={{ color: 'var(--ember, #d9534f)' }}>
          {error}
        </p>
      ) : null}
    </div>
  )
}
