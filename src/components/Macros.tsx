/*
 * Macros — the four performance macros as the loudest control in the family.
 * Each is a single big dial (0..1) mapped to a musician-facing name; turning one
 * calls `setMacro`, and the store fans it out across the patch/FX under the hood.
 */
import { Knob } from './ui'
import { useInstrument } from '../app/useInstrument'
import type { Macros as MacrosState } from '../types'
import './panels.css'

interface MacroDef {
  key: keyof MacrosState
  label: string
  hint: string
}

const MACROS: readonly MacroDef[] = [
  { key: 'glow', label: 'Glow', hint: 'warmth + body' },
  { key: 'motion', label: 'Motion', hint: 'movement + sway' },
  { key: 'air', label: 'Air', hint: 'space + shimmer' },
  { key: 'grit', label: 'Grit', hint: 'drive + edge' },
]

const pct = (v: number): string => `${Math.round(v * 100)}`

export function Macros() {
  const inst = useInstrument()
  const macros = inst.session.macros

  return (
    <div className="macropad">
      {MACROS.map(({ key, label, hint }) => (
        <div key={key} className="macrocell">
          <Knob
            label={label}
            unit="%"
            min={0}
            max={1}
            size={72}
            value={macros[key]}
            format={pct}
            onChange={(v) => inst.setMacro(key, v)}
          />
          <span className="sessionrow__meta">{hint}</span>
        </div>
      ))}
    </div>
  )
}
