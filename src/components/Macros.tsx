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
  help: string
}

const MACROS: readonly MacroDef[] = [
  { key: 'glow', label: 'Glow', hint: 'warmth + body', help: 'Warmth & body — opens the filter and rounds the low end for a fuller tone.' },
  { key: 'motion', label: 'Motion', hint: 'movement + sway', help: 'Movement & sway — adds LFO motion and subtle drift so the sound breathes.' },
  { key: 'air', label: 'Air', hint: 'space + shimmer', help: 'Space & shimmer — adds brightness and reverb air around the sound.' },
  { key: 'grit', label: 'Grit', hint: 'drive + edge', help: 'Drive & edge — adds saturation and harmonic bite for a dirtier tone.' },
]

const pct = (v: number): string => `${Math.round(v * 100)}`

export function Macros() {
  const inst = useInstrument()
  const macros = inst.session.macros

  return (
    <section className="pgroup pgroup--macros">
      <span className="pgroup__title eyebrow">Macros</span>
      <div className="macropad">
      {MACROS.map(({ key, label, hint, help }) => (
        <div key={key} className="macrocell">
          <Knob
            label={label}
            hint={help}
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
    </section>
  )
}
