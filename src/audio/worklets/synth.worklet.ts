/**
 * mkeys polyphonic synth AudioWorklet processor (`mkeys-synth`).
 *
 * A two-oscillator subtractive voice with sub + noise, a resonant state-variable
 * filter driven by its own ADSR, an amp ADSR, unison stacking with stereo spread,
 * portamento glide, and a global LFO. It renders straight to a stereo output
 * (the FX chain — drive/chorus/delay/reverb/limiter — lives on the main thread in
 * `fx.ts`, downstream of this node).
 *
 * Message protocol (main → worklet, see {@link WorkletCommand}):
 *   { type:'noteOn', id, midi, velocity }   start/steal a voice for `id`
 *   { type:'noteOff', id }                  release the voice for `id`
 *   { type:'expression', id, expr }         per-touch pitch/timbre/pressure
 *   { type:'setParam', path, value }        one dotted patch field (e.g. 'filter.cutoff')
 *   { type:'setPatch', patch }              replace the whole patch
 *   { type:'setTempo', bpm }                tempo for tempo-synced LFO
 *   { type:'panic' }                        silence all voices immediately
 *
 * DSP structure derived from mdrone's worklet voices (see NOTICE). Authored in
 * TS; the AudioWorkletGlobalScope surface is declared in worklet-env.d.ts.
 */

import type { OscillatorParams, PatchParams, TouchExpression, WorkletCommand } from '../../types'

/** Maximum simultaneously sounding voices; the oldest is stolen past this. */
const MAX_VOICES = 16
/** Maximum unison stack, matching UnisonParams.voices upper bound. */
const MAX_UNISON = 8
/** Frames in one render quantum. */
const BLOCK = 128
const TWO_PI = Math.PI * 2
/** Beats per bar; a `division` of N means "1/N note" = BEATS_PER_BAR/N beats. */
const BEATS_PER_BAR = 4

/** A sensible, always-valid default patch used until the host sends one. */
function defaultPatch(): PatchParams {
  return {
    osc1: { wave: 'saw', detune: 0, level: 0.8, pulseWidth: 0.5, sync: false, fm: 0 },
    osc2: { wave: 'saw', detune: 6, level: 0.5, pulseWidth: 0.5, sync: false, fm: 0 },
    subLevel: 0.15,
    noiseLevel: 0,
    filter: { cutoff: 4000, resonance: 0.2, drive: 0.1, envAmount: 0.4, keytrack: 0.4 },
    ampEnv: { attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.3 },
    filterEnv: { attack: 0.02, decay: 0.25, sustain: 0.4, release: 0.35 },
    lfo: { rate: 4, depth: 0, target: 'filter', tempoSync: false, division: 4 },
    unison: { voices: 1, detune: 0.2, spread: 0.5 },
    glide: { time: 0, mode: 'off' },
    volume: 0.8,
  }
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n
}

/**
 * PolyBLEP residual for band-limiting saw/pulse discontinuities. `t` is the
 * phase in [0,1), `dt` the per-sample phase increment.
 */
function polyBlep(t: number, dt: number): number {
  if (dt <= 0) return 0
  if (t < dt) {
    const x = t / dt
    return x + x - x * x - 1
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt
    return x * x + x + x + 1
  }
  return 0
}

/** Monotonic counter stamped onto each voice at start, for oldest-first steal. */
let voiceStartCounter = 0

type EnvStage = 'idle' | 'attack' | 'decay' | 'sustain' | 'release'

/** Linear ADSR. Times in seconds; `process` advances by one sample. */
class Envelope {
  private stage: EnvStage = 'idle'
  private level = 0
  private attack = 0.01
  private decay = 0.1
  private sustain = 0.8
  private release = 0.2

  set(attack: number, decay: number, sustain: number, release: number): void {
    this.attack = attack
    this.decay = decay
    this.sustain = sustain
    this.release = release
  }

  gateOn(): void {
    this.stage = 'attack'
  }

  gateOff(): void {
    if (this.stage !== 'idle') this.stage = 'release'
  }

  /** True once fully released (safe to free the voice). */
  isIdle(): boolean {
    return this.stage === 'idle'
  }

  process(dt: number): number {
    switch (this.stage) {
      case 'attack':
        if (this.attack <= 0) {
          this.level = 1
          this.stage = 'decay'
        } else {
          this.level += dt / this.attack
          if (this.level >= 1) {
            this.level = 1
            this.stage = 'decay'
          }
        }
        break
      case 'decay':
        if (this.decay <= 0) {
          this.level = this.sustain
          this.stage = 'sustain'
        } else {
          this.level -= (dt * (1 - this.sustain)) / this.decay
          if (this.level <= this.sustain) {
            this.level = this.sustain
            this.stage = 'sustain'
          }
        }
        break
      case 'sustain':
        this.level = this.sustain
        break
      case 'release':
        if (this.release <= 0) {
          this.level = 0
          this.stage = 'idle'
        } else {
          this.level -= (dt * this.level) / this.release + dt * 1e-4
          if (this.level <= 1e-4) {
            this.level = 0
            this.stage = 'idle'
          }
        }
        break
      case 'idle':
        this.level = 0
        break
    }
    return this.level
  }
}

/** A single stereo synth voice. */
class Voice {
  id = -1
  active = false
  /** Start-order stamp; lowest among active voices is the oldest. */
  startSeq = 0
  private midi = 60
  private velocity = 1
  private currentFreq = 440
  private targetFreq = 440
  private glideCoeff = 1 // 0..1 per-sample approach; 1 = snap
  private timbre = 0
  private pressure = 0

  private readonly phase1 = new Float32Array(MAX_UNISON)
  private readonly phase2 = new Float32Array(MAX_UNISON)
  private subPhase = 0

  // Stereo state-variable filter integrators.
  private lpL = 0
  private bpL = 0
  private lpR = 0
  private bpR = 0

  private readonly ampEnv = new Envelope()
  private readonly filtEnv = new Envelope()

  start(id: number, midi: number, velocity: number, patch: PatchParams): void {
    this.id = id
    this.active = true
    this.startSeq = ++voiceStartCounter
    this.midi = midi
    this.velocity = clamp(velocity, 0, 1)
    this.targetFreq = midiToFreq(midi)
    // Legato/off glide only slides when a voice is already sounding; a fresh
    // voice snaps unless glide is 'always'.
    const legatoSlide = patch.glide.mode === 'always' && this.currentFreq > 0
    if (!legatoSlide) this.currentFreq = this.targetFreq
    this.setGlide(patch)
    if (!legatoSlide) {
      for (let i = 0; i < MAX_UNISON; i++) {
        this.phase1[i] = Math.random()
        this.phase2[i] = Math.random()
      }
      this.subPhase = 0
    }
    this.timbre = 0
    this.pressure = this.velocity
    // Zero the SVF integrators: prevents stale-state clicks on voice reuse and
    // contains any NaN (from a past divergence) to a single note.
    this.lpL = 0
    this.bpL = 0
    this.lpR = 0
    this.bpR = 0
    this.ampEnv.set(
      patch.ampEnv.attack,
      patch.ampEnv.decay,
      patch.ampEnv.sustain,
      patch.ampEnv.release,
    )
    this.filtEnv.set(
      patch.filterEnv.attack,
      patch.filterEnv.decay,
      patch.filterEnv.sustain,
      patch.filterEnv.release,
    )
    this.ampEnv.gateOn()
    this.filtEnv.gateOn()
  }

  release(): void {
    this.ampEnv.gateOff()
    this.filtEnv.gateOff()
  }

  kill(): void {
    this.active = false
    this.id = -1
  }

  setExpression(expr: TouchExpression, patch: PatchParams): void {
    // expr.pitch is an absolute fractional MIDI note (glide/bend already folded
    // in by the surface layer); glide smooths our approach to it.
    this.targetFreq = midiToFreq(expr.pitch)
    this.timbre = clamp(expr.timbre, 0, 1)
    this.pressure = clamp(expr.pressure, 0, 1)
    this.setGlide(patch)
  }

  private setGlide(patch: PatchParams): void {
    const t = patch.glide.time
    if (patch.glide.mode === 'off' || t <= 0) {
      this.glideCoeff = 1
    } else {
      // One-pole approach; reach ~63% of the gap per `time` seconds.
      this.glideCoeff = 1 - Math.exp(-1 / (t * sampleRate))
    }
  }

  /**
   * Render one sample, adding its stereo contribution to `acc` ([L, R]).
   * `lfoPitch`/`lfoFilter`/`lfoAmp` are the LFO's current signed contribution to
   * each destination (already scaled by depth; only the active target is nonzero).
   */
  render(
    acc: Float32Array,
    patch: PatchParams,
    dt: number,
    lfoPitch: number,
    lfoFilter: number,
    lfoAmp: number,
  ): void {
    if (!this.active) return

    // Glide toward the target frequency.
    this.currentFreq += (this.targetFreq - this.currentFreq) * this.glideCoeff
    const baseFreq = this.currentFreq * Math.pow(2, lfoPitch)

    const uni = Math.max(1, Math.min(MAX_UNISON, Math.floor(patch.unison.voices)))
    const detCents = patch.unison.detune * 25 // ±25 cents at full
    const spread = clamp(patch.unison.spread, 0, 1)

    let oscL = 0
    let oscR = 0
    const osc1 = patch.osc1
    const osc2 = patch.osc2
    const det1 = Math.pow(2, (osc1.detune ?? 0) / 1200)
    const det2 = Math.pow(2, (osc2.detune ?? 0) / 1200)
    const pw1 = clamp(osc1.pulseWidth ?? 0.5, 0.05, 0.95)
    const pw2 = clamp(osc2.pulseWidth ?? 0.5, 0.05, 0.95)
    const fmAmt = (osc1.fm ?? 0) * 2

    for (let i = 0; i < uni; i++) {
      // Symmetric detune spread across the stack.
      const spreadPos = uni === 1 ? 0 : (i / (uni - 1)) * 2 - 1
      const detMul = Math.pow(2, (spreadPos * detCents) / 1200)

      const f2 = baseFreq * det2 * detMul
      const inc2 = f2 / sampleRate
      const s2 = oscSample(osc2.wave, this.phase2[i], inc2, pw2)
      // osc2 frequency-modulates osc1 when fm > 0.
      const f1 = baseFreq * det1 * detMul * (1 + s2 * fmAmt * 0.5)
      const inc1 = Math.max(0, f1 / sampleRate)
      const s1 = oscSample(osc1.wave, this.phase1[i], inc1, pw1)

      const mixed = s1 * osc1.level + s2 * osc2.level

      // Equal-power pan for this unison index.
      const pan = spreadPos * spread
      const angle = (pan * 0.5 + 0.5) * (Math.PI / 2)
      oscL += mixed * Math.cos(angle)
      oscR += mixed * Math.sin(angle)

      // Advance phases; hard-sync osc2 to osc1's wrap when requested.
      this.phase1[i] += inc1
      let wrapped = false
      if (this.phase1[i] >= 1) {
        this.phase1[i] -= 1
        wrapped = true
      }
      if (osc1.sync && wrapped) {
        this.phase2[i] = 0
      } else {
        this.phase2[i] += inc2
        if (this.phase2[i] >= 1) this.phase2[i] -= 1
      }
    }

    // Normalise unison sum and center-balance the stereo field.
    const norm = 1 / Math.sqrt(uni)
    oscL *= norm
    oscR *= norm

    // Sub oscillator (one octave below the fundamental) + noise, mono → both.
    const subInc = baseFreq * 0.5 / sampleRate
    const sub = Math.sin(this.subPhase * TWO_PI) * patch.subLevel
    this.subPhase += subInc
    if (this.subPhase >= 1) this.subPhase -= 1
    const noise = patch.noiseLevel > 0 ? (Math.random() * 2 - 1) * patch.noiseLevel : 0
    oscL += sub + noise
    oscR += sub + noise

    // Envelopes.
    const ampLevel = this.ampEnv.process(dt)
    const filtLevel = this.filtEnv.process(dt)
    if (this.ampEnv.isIdle()) {
      this.kill()
      return
    }

    // Filter cutoff: base × keytrack × filter-env × timbre × LFO.
    const f = patch.filter
    const keyMul = Math.pow(2, (f.keytrack * (this.midi - 60)) / 12)
    const envMul = Math.pow(2, filtLevel * f.envAmount * 4)
    const timbreMul = Math.pow(2, this.timbre * 2)
    const lfoMul = Math.pow(2, lfoFilter * 4)
    let cutoff = f.cutoff * keyMul * envMul * timbreMul * lfoMul
    // Chamberlin SVF is only stable while fc < fs/4; stay comfortably below it
    // so envelope/timbre/LFO peaks can't push the coefficient into divergence.
    cutoff = clamp(cutoff, 20, sampleRate * 0.22)

    // Chamberlin SVF coefficients (stable while fc < fs/4).
    const fc = 2 * Math.sin((Math.PI * cutoff) / sampleRate)
    const q = clamp(2 - f.resonance * 1.9, 0.1, 2)

    let outL = svfStep(this, 'L', oscL, fc, q)
    let outR = svfStep(this, 'R', oscR, fc, q)

    // Post-filter drive (soft tanh) for extra bite.
    if (f.drive > 0) {
      const k = 1 + f.drive * 4
      outL = Math.tanh(outL * k) / Math.tanh(k)
      outR = Math.tanh(outR * k) / Math.tanh(k)
    }

    // Amp: envelope × velocity × pressure × (1 + amp-LFO).
    const gain = ampLevel * (0.4 + 0.6 * this.velocity) * (0.6 + 0.4 * this.pressure) * (1 + lfoAmp)
    acc[0] += outL * gain
    acc[1] += outR * gain
  }

  // SVF integrator access (kept as methods so state stays encapsulated).
  stepL(input: number, fc: number, q: number): number {
    this.lpL += fc * this.bpL
    const hp = input - this.lpL - q * this.bpL
    this.bpL += fc * hp
    return this.lpL
  }

  stepR(input: number, fc: number, q: number): number {
    this.lpR += fc * this.bpR
    const hp = input - this.lpR - q * this.bpR
    this.bpR += fc * hp
    return this.lpR
  }
}

/** Dispatch to the correct SVF channel without exposing integrator fields. */
function svfStep(v: Voice, ch: 'L' | 'R', input: number, fc: number, q: number): number {
  return ch === 'L' ? v.stepL(input, fc, q) : v.stepR(input, fc, q)
}

/** One naive/band-limited oscillator sample for the given wave at `phase`. */
function oscSample(
  wave: OscillatorParams['wave'],
  phase: number,
  inc: number,
  pulseWidth: number,
): number {
  switch (wave) {
    case 'sine':
      return Math.sin(phase * TWO_PI)
    case 'triangle':
      return 4 * Math.abs(phase - 0.5) - 1
    case 'saw':
      return 2 * phase - 1 - polyBlep(phase, inc)
    case 'pulse': {
      // Difference of two saws separated by the pulse width.
      const saw1 = 2 * phase - 1 - polyBlep(phase, inc)
      let p2 = phase + (1 - pulseWidth)
      if (p2 >= 1) p2 -= 1
      const saw2 = 2 * p2 - 1 - polyBlep(p2, inc)
      return saw1 - saw2
    }
  }
}

/** Set a single dotted patch field. Returns silently on unknown/typed paths. */
function setPatchParam(patch: PatchParams, path: string, value: number): void {
  const parts = path.split('.')
  if (parts.length === 1) {
    if (path === 'subLevel') patch.subLevel = value
    else if (path === 'noiseLevel') patch.noiseLevel = value
    else if (path === 'volume') patch.volume = value
    return
  }
  const [group, field] = parts
  const target = (patch as unknown as Record<string, Record<string, number>>)[group]
  if (target && typeof target === 'object' && field in target) {
    target[field] = value
  }
}

class SynthProcessor extends AudioWorkletProcessor {
  private patch: PatchParams = defaultPatch()
  private readonly voices: Voice[] = []
  private lfoPhase = 0
  private bpm = 120

  constructor() {
    super()
    for (let i = 0; i < MAX_VOICES; i++) this.voices.push(new Voice())
    this.port.onmessage = (e: MessageEvent<WorkletCommand>) => this.handle(e.data)
  }

  private handle(cmd: WorkletCommand): void {
    switch (cmd.type) {
      case 'noteOn':
        this.noteOn(cmd.id, cmd.midi, cmd.velocity)
        break
      case 'noteOff':
        for (const v of this.voices) if (v.active && v.id === cmd.id) v.release()
        break
      case 'expression':
        for (const v of this.voices) if (v.active && v.id === cmd.id) v.setExpression(cmd.expr, this.patch)
        break
      case 'setParam':
        setPatchParam(this.patch, cmd.path, cmd.value)
        break
      case 'setPatch':
        this.patch = cmd.patch
        break
      case 'setTempo':
        this.bpm = cmd.bpm > 0 ? cmd.bpm : 120
        break
      case 'panic':
        for (const v of this.voices) v.kill()
        break
    }
  }

  private noteOn(id: number, midi: number, velocity: number): void {
    // Reuse a voice already holding this id, else a free one, else steal the
    // oldest (lowest startSeq) so a held note isn't retriggered repeatedly.
    let voice = this.voices.find((v) => v.active && v.id === id)
    if (!voice) voice = this.voices.find((v) => !v.active)
    if (!voice) {
      voice = this.voices[0]
      for (const v of this.voices) if (v.startSeq < voice.startSeq) voice = v
    }
    voice.start(id, midi, velocity, this.patch)
  }

  /** Current LFO frequency in Hz, honouring tempo sync. */
  private lfoFrequency(): number {
    const lfo = this.patch.lfo
    if (lfo.tempoSync) {
      // `division: N` means a 1/N-note cycle, i.e. BEATS_PER_BAR/N beats per
      // cycle → (bpm/60) * (N / BEATS_PER_BAR) Hz. 1/8 at 120 BPM = 4 Hz.
      const div = Math.max(1, lfo.division ?? 4)
      return (this.bpm / 60) * (div / BEATS_PER_BAR)
    }
    return Math.max(0, lfo.rate)
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]
    if (!out || out.length === 0) return true
    const left = out[0]
    const right = out.length > 1 ? out[1] : out[0]

    const dt = 1 / sampleRate
    const lfoInc = this.lfoFrequency() / sampleRate
    const depth = clamp(this.patch.lfo.depth, 0, 1)
    const target = this.patch.lfo.target
    const acc = new Float32Array(2)

    for (let i = 0; i < BLOCK; i++) {
      // Global LFO (sine, bipolar).
      const lfo = Math.sin(this.lfoPhase * TWO_PI) * depth
      this.lfoPhase += lfoInc
      if (this.lfoPhase >= 1) this.lfoPhase -= 1
      const lfoPitch = target === 'pitch' ? lfo * (2 / 12) : 0 // ±2 semitones
      const lfoFilter = target === 'filter' ? lfo : 0
      const lfoAmp = target === 'amp' ? lfo * 0.5 : 0

      acc[0] = 0
      acc[1] = 0
      for (const v of this.voices) {
        v.render(acc, this.patch, dt, lfoPitch, lfoFilter, lfoAmp)
      }
      const vol = this.patch.volume
      left[i] = acc[0] * vol
      right[i] = acc[1] * vol
    }
    return true
  }
}

registerProcessor('mkeys-synth', SynthProcessor)
