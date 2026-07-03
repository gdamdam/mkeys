/*
 * PatchPanel — the synth editor. Grouped the way you'd reach for the controls:
 * oscillators, sub/noise, filter, the two envelopes, LFO, unison and glide.
 * Every control builds the next PatchParams immutably from `session.patch` and
 * hands the whole patch to `updatePatch` (the store diffs + pushes to the engine).
 */
import { Knob, Segmented, Select, Toggle } from './ui'
import type { SegmentedOption, SelectOption } from './ui'
import { useInstrument } from '../app/useInstrument'
import type {
  GlideParams,
  LfoParams,
  OscillatorParams,
  PatchParams,
} from '../types'
import './panels.css'

const WAVE_OPTIONS: ReadonlyArray<SegmentedOption<OscillatorParams['wave']>> = [
  { value: 'saw', label: 'Saw' },
  { value: 'pulse', label: 'Pulse' },
  { value: 'sine', label: 'Sine' },
  { value: 'triangle', label: 'Tri' },
]

const LFO_TARGETS: ReadonlyArray<SelectOption<LfoParams['target']>> = [
  { value: 'pitch', label: 'Pitch' },
  { value: 'filter', label: 'Filter' },
  { value: 'amp', label: 'Amp' },
]

const GLIDE_MODES: ReadonlyArray<SegmentedOption<GlideParams['mode']>> = [
  { value: 'legato', label: 'Legato' },
  { value: 'always', label: 'Always' },
  { value: 'off', label: 'Off' },
]

const DIVISIONS: ReadonlyArray<SelectOption<string>> = [
  { value: '1', label: '1/1' },
  { value: '2', label: '1/2' },
  { value: '4', label: '1/4' },
  { value: '8', label: '1/8' },
  { value: '16', label: '1/16' },
]

const pct = (v: number): string => `${Math.round(v * 100)}`
const cents = (v: number): string => `${Math.round(v)}`
const secs = (v: number): string => `${v.toFixed(2)}`
const hz = (v: number): string => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`)

export function PatchPanel() {
  const inst = useInstrument()
  const patch = inst.session.patch

  const set = (partial: Partial<PatchParams>): void => inst.updatePatch({ ...patch, ...partial })

  const renderOsc = (
    label: string,
    osc: OscillatorParams,
    commit: (next: OscillatorParams) => void,
  ) => {
    const upd = (p: Partial<OscillatorParams>): void => commit({ ...osc, ...p })
    return (
      <div className="psub">
        <span className="psub__label eyebrow">{label}</span>
        <Segmented
          label={`${label} wave`}
          hideLabel
          options={WAVE_OPTIONS}
          value={osc.wave}
          onChange={(wave) => upd({ wave })}
        />
        <div className="pshelf">
          <Knob
            label="Detune"
            unit="¢"
            min={-100}
            max={100}
            value={osc.detune}
            format={cents}
            onChange={(detune) => upd({ detune })}
          />
          <Knob
            label="Level"
            unit="%"
            min={0}
            max={1}
            value={osc.level}
            format={pct}
            onChange={(level) => upd({ level })}
          />
          <Knob
            label="PW"
            unit="%"
            min={0}
            max={1}
            value={osc.pulseWidth ?? 0.5}
            format={pct}
            onChange={(pulseWidth) => upd({ pulseWidth })}
          />
          <Knob
            label="FM"
            unit="%"
            min={0}
            max={1}
            value={osc.fm ?? 0}
            format={pct}
            onChange={(fm) => upd({ fm })}
          />
          <Toggle
            label="Sync"
            checked={osc.sync ?? false}
            onChange={(sync) => upd({ sync })}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="pgroup-wrap">
      {/* Oscillators */}
      <section className="pgroup">
        <span className="pgroup__title eyebrow">Oscillators</span>
        {renderOsc('Osc 1', patch.osc1, (osc1) => set({ osc1 }))}
        {renderOsc('Osc 2', patch.osc2, (osc2) => set({ osc2 }))}
        <div className="pshelf">
          <Knob
            label="Sub"
            unit="%"
            min={0}
            max={1}
            value={patch.subLevel}
            format={pct}
            onChange={(subLevel) => set({ subLevel })}
          />
          <Knob
            label="Noise"
            unit="%"
            min={0}
            max={1}
            value={patch.noiseLevel}
            format={pct}
            onChange={(noiseLevel) => set({ noiseLevel })}
          />
        </div>
      </section>

      {/* Filter */}
      <section className="pgroup">
        <span className="pgroup__title eyebrow">Filter</span>
        <div className="pshelf">
          <Knob
            label="Cutoff"
            unit="Hz"
            min={20}
            max={20000}
            value={patch.filter.cutoff}
            format={hz}
            onChange={(cutoff) => set({ filter: { ...patch.filter, cutoff } })}
          />
          <Knob
            label="Reso"
            unit="%"
            min={0}
            max={1}
            value={patch.filter.resonance}
            format={pct}
            onChange={(resonance) => set({ filter: { ...patch.filter, resonance } })}
          />
          <Knob
            label="Drive"
            unit="%"
            min={0}
            max={1}
            value={patch.filter.drive}
            format={pct}
            onChange={(drive) => set({ filter: { ...patch.filter, drive } })}
          />
          <Knob
            label="Env amt"
            unit="%"
            min={-1}
            max={1}
            value={patch.filter.envAmount}
            format={pct}
            onChange={(envAmount) => set({ filter: { ...patch.filter, envAmount } })}
          />
          <Knob
            label="Keytrack"
            unit="%"
            min={0}
            max={1}
            value={patch.filter.keytrack}
            format={pct}
            onChange={(keytrack) => set({ filter: { ...patch.filter, keytrack } })}
          />
        </div>
      </section>

      {/* Envelopes */}
      <section className="pgroup">
        <span className="pgroup__title eyebrow">Envelopes</span>
        <div className="pshelf">
          <div className="psub">
            <span className="psub__label eyebrow">Amp</span>
            <div className="pshelf">
              <Knob label="A" unit="s" min={0} max={4} value={patch.ampEnv.attack} format={secs} onChange={(attack) => set({ ampEnv: { ...patch.ampEnv, attack } })} />
              <Knob label="D" unit="s" min={0} max={4} value={patch.ampEnv.decay} format={secs} onChange={(decay) => set({ ampEnv: { ...patch.ampEnv, decay } })} />
              <Knob label="S" unit="%" min={0} max={1} value={patch.ampEnv.sustain} format={pct} onChange={(sustain) => set({ ampEnv: { ...patch.ampEnv, sustain } })} />
              <Knob label="R" unit="s" min={0} max={4} value={patch.ampEnv.release} format={secs} onChange={(release) => set({ ampEnv: { ...patch.ampEnv, release } })} />
            </div>
          </div>
          <div className="psub">
            <span className="psub__label eyebrow">Filter</span>
            <div className="pshelf">
              <Knob label="A" unit="s" min={0} max={4} value={patch.filterEnv.attack} format={secs} onChange={(attack) => set({ filterEnv: { ...patch.filterEnv, attack } })} />
              <Knob label="D" unit="s" min={0} max={4} value={patch.filterEnv.decay} format={secs} onChange={(decay) => set({ filterEnv: { ...patch.filterEnv, decay } })} />
              <Knob label="S" unit="%" min={0} max={1} value={patch.filterEnv.sustain} format={pct} onChange={(sustain) => set({ filterEnv: { ...patch.filterEnv, sustain } })} />
              <Knob label="R" unit="s" min={0} max={4} value={patch.filterEnv.release} format={secs} onChange={(release) => set({ filterEnv: { ...patch.filterEnv, release } })} />
            </div>
          </div>
        </div>
      </section>

      {/* LFO */}
      <section className="pgroup">
        <span className="pgroup__title eyebrow">LFO</span>
        <div className="pshelf">
          <Knob
            label="Rate"
            unit="Hz"
            min={0.01}
            max={20}
            step={0.01}
            value={patch.lfo.rate}
            format={(v) => v.toFixed(2)}
            disabled={patch.lfo.tempoSync}
            onChange={(rate) => set({ lfo: { ...patch.lfo, rate } })}
          />
          <Knob
            label="Depth"
            unit="%"
            min={0}
            max={1}
            value={patch.lfo.depth}
            format={pct}
            onChange={(depth) => set({ lfo: { ...patch.lfo, depth } })}
          />
          <Select
            label="Target"
            options={LFO_TARGETS}
            value={patch.lfo.target}
            onChange={(target) => set({ lfo: { ...patch.lfo, target } })}
          />
          <Toggle
            label="Tempo sync"
            checked={patch.lfo.tempoSync}
            onChange={(tempoSync) => set({ lfo: { ...patch.lfo, tempoSync } })}
          />
          <Select
            label="Division"
            options={DIVISIONS}
            value={String(patch.lfo.division ?? 4)}
            disabled={!patch.lfo.tempoSync}
            onChange={(v) => set({ lfo: { ...patch.lfo, division: Number(v) } })}
          />
        </div>
      </section>

      {/* Unison + Glide + Volume */}
      <section className="pgroup">
        <span className="pgroup__title eyebrow">Voicing</span>
        <div className="pshelf">
          <div className="psub">
            <span className="psub__label eyebrow">Unison</span>
            <div className="pshelf">
              <Knob label="Voices" min={1} max={8} step={1} value={patch.unison.voices} format={(v) => `${Math.round(v)}`} onChange={(voices) => set({ unison: { ...patch.unison, voices: Math.round(voices) } })} />
              <Knob label="Detune" unit="%" min={0} max={1} value={patch.unison.detune} format={pct} onChange={(detune) => set({ unison: { ...patch.unison, detune } })} />
              <Knob label="Spread" unit="%" min={0} max={1} value={patch.unison.spread} format={pct} onChange={(spread) => set({ unison: { ...patch.unison, spread } })} />
            </div>
          </div>
          <div className="psub">
            <span className="psub__label eyebrow">Glide</span>
            <div className="pshelf">
              <Knob label="Time" unit="s" min={0} max={1} value={patch.glide.time} format={secs} onChange={(time) => set({ glide: { ...patch.glide, time } })} />
              <Segmented
                label="Glide mode"
                hideLabel
                options={GLIDE_MODES}
                value={patch.glide.mode}
                onChange={(mode) => set({ glide: { ...patch.glide, mode } })}
              />
            </div>
          </div>
          <Knob
            label="Volume"
            unit="%"
            min={0}
            max={1}
            value={patch.volume}
            format={pct}
            onChange={(volume) => set({ volume })}
          />
        </div>
      </section>
    </div>
  )
}
