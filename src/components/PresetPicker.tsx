/*
 * PresetPicker — the sound library, grouped by category. Tapping a preset calls
 * `loadPreset`; the currently loaded one (session.presetName) stays lit. Preset
 * names render in Fraunces so the library reads like a set list, not a form.
 */
import { useInstrument } from '../app/useInstrument'
import { PRESETS, PRESET_CATEGORIES } from '../audio'
import type { Preset } from '../audio'
import './panels.css'

const CATEGORY_LABELS: Record<Preset['category'], string> = {
  lead: 'Leads',
  pad: 'Pads',
  pluck: 'Plucks',
  bass: 'Bass',
  ambient: 'Ambient',
}

export function PresetPicker() {
  const inst = useInstrument()
  const current = inst.session.presetName

  return (
    <div className="presetlib">
      {PRESET_CATEGORIES.map((cat) => {
        const items = PRESETS.filter((p) => p.category === cat)
        if (items.length === 0) return null
        return (
          <section key={cat} className="presetcat">
            <span className="presetcat__label eyebrow">{CATEGORY_LABELS[cat]}</span>
            <div className="presetgrid">
              {items.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  className="presetchip"
                  aria-pressed={p.name === current}
                  onClick={() => inst.loadPreset(p.name)}
                >
                  <span className="presetchip__name">{p.name}</span>
                </button>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
