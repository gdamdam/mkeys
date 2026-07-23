/*
 * PatchPanel — the synth editor. Grouped the way you'd reach for the controls:
 * oscillators, sub/noise, filter, the two envelopes, LFO, unison and glide.
 * Every control builds the next PatchParams immutably from `session.patch` and
 * hands the whole patch to `updatePatch` (the store diffs + pushes to the engine).
 */
import { Knob, Segmented, Select, Toggle } from './ui'
import type { SegmentedOption, SelectOption } from './ui'
import { useInstrument } from '../app/useInstrument'
import { EnvelopeGraph, FilterCurve, WaveformIcon } from './synthviz'
import type {
  FxParams,
  GlideParams,
  LfoParams,
  OscillatorParams,
  PatchParams,
} from '../types'
import './panels.css'
import './synthviz.css'

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
const db = (v: number): string => `${v.toFixed(1)}`

export function PatchPanel() {
  const inst = useInstrument()
  const patch = inst.session.patch

  const set = (partial: Partial<PatchParams>): void => inst.updatePatch({ ...patch, ...partial })

  const fx = inst.session.fx
  const fxSet = (partial: Partial<FxParams>): void => inst.updateFx({ ...fx, ...partial })

  const renderOsc = (
    label: string,
    osc: OscillatorParams,
    commit: (next: OscillatorParams) => void,
  ) => {
    const upd = (p: Partial<OscillatorParams>): void => commit({ ...osc, ...p })
    return (
      <div className="psub">
        <span className="psub__label eyebrow">{label}</span>
        {/* Live preview of the actual wave — pulse shows the PW knob's duty. */}
        <WaveformIcon wave={osc.wave} pulseWidth={osc.pulseWidth ?? 0.5} className="psub__wave" />
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
            hint="Fine pitch offset in cents. Small amounts thicken the tone against the other oscillator."
            unit="¢"
            min={-100}
            max={100}
            value={osc.detune}
            format={cents}
            onChange={(detune) => upd({ detune })}
          />
          <Knob
            label="Level"
            hint="How loud this oscillator is in the mix."
            unit="%"
            min={0}
            max={1}
            value={osc.level}
            format={pct}
            onChange={(level) => upd({ level })}
          />
          <Knob
            label="PW"
            hint="Pulse width — the duty cycle of the pulse wave. Only affects the Pulse shape."
            unit="%"
            min={0}
            max={1}
            value={osc.pulseWidth ?? 0.5}
            format={pct}
            onChange={(pulseWidth) => upd({ pulseWidth })}
          />
          <Knob
            label="FM"
            hint="Frequency modulation depth — the other oscillator modulates this pitch for metallic, bell-like timbres."
            unit="%"
            min={0}
            max={1}
            value={osc.fm ?? 0}
            format={pct}
            onChange={(fm) => upd({ fm })}
          />
          <Toggle
            label="Sync"
            hint="hard-sync to the other osc"
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
            hint="Sub-oscillator level — a sine one octave below the note for extra weight and body."
            unit="%"
            min={0}
            max={1}
            value={patch.subLevel}
            format={pct}
            onChange={(subLevel) => set({ subLevel })}
          />
          <Knob
            label="Noise"
            hint="White-noise level — adds breath and air, or a percussive edge to the attack."
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
        {/* Response curve: cutoff slides the knee, resonance raises the peak. */}
        <FilterCurve
          cutoff={patch.filter.cutoff}
          resonance={patch.filter.resonance}
          className="section__viz"
        />
        <div className="pshelf">
          <Knob
            label="Cutoff"
            hint="Cutoff frequency. Everything above it is progressively removed — lower it for a darker, muffled tone."
            unit="Hz"
            min={20}
            max={20000}
            value={patch.filter.cutoff}
            format={hz}
            onChange={(cutoff) => set({ filter: { ...patch.filter, cutoff } })}
          />
          <Knob
            label="Reso"
            hint="Resonance. Emphasises frequencies right at the cutoff, adding a vocal, whistling peak."
            unit="%"
            min={0}
            max={1}
            value={patch.filter.resonance}
            format={pct}
            onChange={(resonance) => set({ filter: { ...patch.filter, resonance } })}
          />
          <Knob
            label="Drive"
            hint="Overdrive into the filter — adds harmonic grit and saturation."
            unit="%"
            min={0}
            max={1}
            value={patch.filter.drive}
            format={pct}
            onChange={(drive) => set({ filter: { ...patch.filter, drive } })}
          />
          <Knob
            label="Env amt"
            hint="How much the filter envelope opens (or, when negative, closes) the cutoff over time."
            unit="%"
            min={-1}
            max={1}
            value={patch.filter.envAmount}
            format={pct}
            onChange={(envAmount) => set({ filter: { ...patch.filter, envAmount } })}
          />
          <Knob
            label="Keytrack"
            hint="How much the cutoff follows the note pitch — higher notes open the filter further."
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
            <EnvelopeGraph
              attack={patch.ampEnv.attack}
              decay={patch.ampEnv.decay}
              sustain={patch.ampEnv.sustain}
              release={patch.ampEnv.release}
              className="section__viz"
            />
            <div className="pshelf">
              <Knob label="A" hint="Attack — time to reach full volume after a note starts." unit="s" min={0} max={4} value={patch.ampEnv.attack} format={secs} onChange={(attack) => set({ ampEnv: { ...patch.ampEnv, attack } })} />
              <Knob label="D" hint="Decay — time to fall from the peak down to the sustain level." unit="s" min={0} max={4} value={patch.ampEnv.decay} format={secs} onChange={(decay) => set({ ampEnv: { ...patch.ampEnv, decay } })} />
              <Knob label="S" hint="Sustain — the held volume level while the note stays down." unit="%" min={0} max={1} value={patch.ampEnv.sustain} format={pct} onChange={(sustain) => set({ ampEnv: { ...patch.ampEnv, sustain } })} />
              <Knob label="R" hint="Release — time to fade to silence after the note is let go." unit="s" min={0} max={4} value={patch.ampEnv.release} format={secs} onChange={(release) => set({ ampEnv: { ...patch.ampEnv, release } })} />
            </div>
          </div>
          <div className="psub">
            <span className="psub__label eyebrow">Filter</span>
            <EnvelopeGraph
              attack={patch.filterEnv.attack}
              decay={patch.filterEnv.decay}
              sustain={patch.filterEnv.sustain}
              release={patch.filterEnv.release}
              className="section__viz"
            />
            <div className="pshelf">
              <Knob label="A" hint="Attack — time for the filter envelope to rise to its peak." unit="s" min={0} max={4} value={patch.filterEnv.attack} format={secs} onChange={(attack) => set({ filterEnv: { ...patch.filterEnv, attack } })} />
              <Knob label="D" hint="Decay — time for the filter envelope to fall to its sustain level." unit="s" min={0} max={4} value={patch.filterEnv.decay} format={secs} onChange={(decay) => set({ filterEnv: { ...patch.filterEnv, decay } })} />
              <Knob label="S" hint="Sustain — the held filter-envelope level while the note is down." unit="%" min={0} max={1} value={patch.filterEnv.sustain} format={pct} onChange={(sustain) => set({ filterEnv: { ...patch.filterEnv, sustain } })} />
              <Knob label="R" hint="Release — time for the filter envelope to fall after the note is let go." unit="s" min={0} max={4} value={patch.filterEnv.release} format={secs} onChange={(release) => set({ filterEnv: { ...patch.filterEnv, release } })} />
            </div>
          </div>
        </div>
      </section>

      {/* LFO */}
      <section className="pgroup">
        <span className="pgroup__title eyebrow">LFO</span>
        {/* A sine, cycling faster/slower with Rate — the modulation shape. */}
        <WaveformIcon wave="sine" className="psub__wave" />
        <div className="pshelf">
          <Knob
            label="Rate"
            hint="LFO speed in Hz — how fast the modulation cycles. Disabled when tempo-synced."
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
            hint="How strongly the LFO modulates its target."
            unit="%"
            min={0}
            max={1}
            value={patch.lfo.depth}
            format={pct}
            onChange={(depth) => set({ lfo: { ...patch.lfo, depth } })}
          />
          <Select
            label="Target"
            title="What the LFO modulates — Pitch (vibrato), Filter (wobble), or Amp (tremolo)."
            options={LFO_TARGETS}
            value={patch.lfo.target}
            onChange={(target) => set({ lfo: { ...patch.lfo, target } })}
          />
          <Toggle
            label="Tempo sync"
            hint="lock rate to tempo"
            checked={patch.lfo.tempoSync}
            onChange={(tempoSync) => set({ lfo: { ...patch.lfo, tempoSync } })}
          />
          <Select
            label="Division"
            title="Tempo-synced LFO rate, as a note division of the beat."
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
              <Knob label="Voices" hint="Number of stacked, detuned copies played per note — more voices sound thicker and wider." min={1} max={8} step={1} value={patch.unison.voices} format={(v) => `${Math.round(v)}`} onChange={(voices) => set({ unison: { ...patch.unison, voices: Math.round(voices) } })} />
              <Knob label="Detune" hint="How far apart the unison voices are tuned — more detune, richer chorus." unit="%" min={0} max={1} value={patch.unison.detune} format={pct} onChange={(detune) => set({ unison: { ...patch.unison, detune } })} />
              <Knob label="Spread" hint="Stereo width of the unison voices across the panorama." unit="%" min={0} max={1} value={patch.unison.spread} format={pct} onChange={(spread) => set({ unison: { ...patch.unison, spread } })} />
            </div>
          </div>
          <div className="psub">
            <span className="psub__label eyebrow">Glide</span>
            <div className="pshelf">
              <Knob label="Time" hint="Portamento time — how long the pitch slides from one note to the next." unit="s" min={0} max={1} value={patch.glide.time} format={secs} onChange={(time) => set({ glide: { ...patch.glide, time } })} />
              <Segmented
                label="Glide mode"
                hideLabel
                title="Legato: glide only when notes overlap. Always: glide on every note. Off: no glide."
                options={GLIDE_MODES}
                value={patch.glide.mode}
                onChange={(mode) => set({ glide: { ...patch.glide, mode } })}
              />
            </div>
          </div>
          <Knob
            label="Volume"
            hint="Overall output level of this patch."
            unit="%"
            min={0}
            max={1}
            value={patch.volume}
            format={pct}
            onChange={(volume) => set({ volume })}
          />
        </div>
      </section>

      {/* Master FX — the post-voice chain (fx.ts): drive → chorus → delay →
          reverb → limiter. Stored in session.fx and swapped by presets; these
          controls edit the base, with the four Macros layered on top. */}
      <section className="pgroup">
        <span className="pgroup__title eyebrow">Master FX</span>
        <div className="pshelf">
          <Knob
            label="Drive"
            hint="Master saturation — soft-clip warmth and harmonic bite across the whole mix."
            unit="%"
            min={0}
            max={1}
            value={fx.drive}
            format={pct}
            onChange={(drive) => fxSet({ drive })}
          />
          <Knob
            label="Chorus"
            hint="Modulated-delay thickening — width and shimmer."
            unit="%"
            min={0}
            max={1}
            value={fx.chorus}
            format={pct}
            onChange={(chorus) => fxSet({ chorus })}
          />
          <div className="psub">
            <span className="psub__label eyebrow">Delay</span>
            <div className="pshelf">
              <Knob label="Mix" hint="Delay wet level — how loud the echoes are." unit="%" min={0} max={1} value={fx.delay.mix} format={pct} onChange={(mix) => fxSet({ delay: { ...fx.delay, mix } })} />
              <Knob label="Fbk" hint="Feedback — how many times each echo repeats (capped below self-oscillation)." unit="%" min={0} max={0.95} value={fx.delay.feedback} format={pct} onChange={(feedback) => fxSet({ delay: { ...fx.delay, feedback } })} />
              <Knob label="Time" hint="Delay time in seconds. Disabled when tempo-synced." unit="s" min={0.01} max={2} step={0.01} value={fx.delay.time} format={secs} disabled={fx.delay.tempoSync} onChange={(time) => fxSet({ delay: { ...fx.delay, time } })} />
              <Toggle label="Tempo sync" hint="lock delay time to tempo" checked={fx.delay.tempoSync} onChange={(tempoSync) => fxSet({ delay: { ...fx.delay, tempoSync } })} />
              <Select
                label="Division"
                title="Tempo-synced delay time, as a note division of the beat."
                options={DIVISIONS}
                value={String(fx.delay.division ?? 8)}
                disabled={!fx.delay.tempoSync}
                onChange={(v) => fxSet({ delay: { ...fx.delay, division: Number(v) } })}
              />
            </div>
          </div>
          <div className="psub">
            <span className="psub__label eyebrow">Reverb</span>
            <div className="pshelf">
              <Knob label="Size" hint="Reverb tail length and space — small room to long hall." unit="%" min={0} max={1} value={fx.reverb.size} format={pct} onChange={(size) => fxSet({ reverb: { ...fx.reverb, size } })} />
              <Knob label="Mix" hint="Reverb wet level — how much space is blended in." unit="%" min={0} max={1} value={fx.reverb.mix} format={pct} onChange={(mix) => fxSet({ reverb: { ...fx.reverb, mix } })} />
            </div>
          </div>
          <Knob
            label="Limiter"
            hint="Master limiter threshold (dB) — lower catches peaks harder for a louder, safer output."
            unit="dB"
            min={-24}
            max={0}
            step={0.5}
            value={fx.limiterThreshold}
            format={db}
            onChange={(limiterThreshold) => fxSet({ limiterThreshold })}
          />
        </div>
      </section>
    </div>
  )
}
