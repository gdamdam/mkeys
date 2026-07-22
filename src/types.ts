/**
 * mkeys shared type contract.
 *
 * This module is the single source of truth every downstream module imports
 * (harmony, surface, audio, transport, midi, persistence, sharing, state).
 * Naming follows the mchord conventions where the domains overlap (PitchClass,
 * Mode/MODES). Strict, fully typed, no `any`. See NOTICE for derivation lineage.
 */

/**
 * The portable microtuning model, vendored from mdrone (see
 * src/vendor/tuning-core). Re-exported here so downstream modules keep importing
 * their whole type contract from one place.
 */
export type { PortableTuning } from './vendor/tuning-core/model'
import type { PortableTuning } from './vendor/tuning-core/model'
export type { KeyboardMap } from './harmony/tuning'
import type { KeyboardMap } from './harmony/tuning'

/** A pitch class 0–11 (0 = C, 1 = C#/Db, ... 11 = B). */
export type PitchClass = number

/**
 * Scale/mode identity. IMPORTANT: `MODES` is APPEND-ONLY — persisted sessions
 * and share links may encode a mode by its index, so never reorder or remove
 * entries. Add new modes only at the end.
 */
export type Mode =
  | 'major'
  | 'natural-minor'
  | 'dorian'
  | 'mixolydian'
  | 'phrygian'
  | 'lydian'
  | 'harmonic-minor'
  | 'pentatonic-major'
  | 'pentatonic-minor'
  | 'blues'

/** All modes in stable, APPEND-ONLY order. Index doubles as a wire encoding. */
export const MODES: readonly Mode[] = [
  'major',
  'natural-minor',
  'dorian',
  'mixolydian',
  'phrygian',
  'lydian',
  'harmonic-minor',
  'pentatonic-major',
  'pentatonic-minor',
  'blues',
]

/** Layout + geometry of the playing surface. */
export interface SurfaceConfig {
  layout: 'grid' | 'piano'
  rows: number
  cols: number
  /** Isomorphic vertical offset in scale degrees between stacked rows (e.g. 3 ≈ 4ths). */
  rowOffsetDegrees: number
  /** Glide quantization amount, 0 (free/continuous) .. 1 (snap to scale). */
  quantize: number
  baseOctave: number
}

/** A single addressable cell on the surface. */
export interface ScalePlacement {
  degree: number
  octave: number
  midi: number
}

/** Per-touch continuous expression state (MPE-style). */
export interface TouchExpression {
  /** Fractional MIDI note number (includes glide/bend). */
  pitch: number
  glide: number
  /** Vertical timbre axis, 0 .. 1. */
  timbre: number
  /** Pressure / aftertouch, 0 .. 1. */
  pressure: number
}

/** ADSR envelope. */
export interface EnvParams {
  attack: number
  decay: number
  sustain: number
  release: number
}

/** One oscillator in the two-oscillator voice. */
export interface OscillatorParams {
  wave: 'saw' | 'pulse' | 'sine' | 'triangle'
  detune: number
  level: number
  pulseWidth?: number
  sync?: boolean
  fm?: number
}

/** Resonant filter with envelope and keytracking. */
export interface FilterParams {
  cutoff: number
  resonance: number
  drive: number
  envAmount: number
  keytrack: number
}

/** Low-frequency modulator. */
export interface LfoParams {
  rate: number
  depth: number
  target: 'pitch' | 'filter' | 'amp'
  tempoSync: boolean
  division?: number
}

/** Unison voice stacking. */
export interface UnisonParams {
  voices: number
  detune: number
  spread: number
}

/** Portamento / glide behaviour. */
export interface GlideParams {
  time: number
  mode: 'legato' | 'always' | 'off'
}

/** Full synth patch. */
export interface PatchParams {
  osc1: OscillatorParams
  osc2: OscillatorParams
  subLevel: number
  noiseLevel: number
  filter: FilterParams
  ampEnv: EnvParams
  filterEnv: EnvParams
  lfo: LfoParams
  unison: UnisonParams
  glide: GlideParams
  volume: number
}

/** Tempo-synced delay. */
export interface DelayParams {
  time: number
  feedback: number
  mix: number
  tempoSync: boolean
  division: number
}

/** Reverb. */
export interface ReverbParams {
  size: number
  mix: number
}

/** Master FX chain. */
export interface FxParams {
  drive: number
  chorus: number
  delay: DelayParams
  reverb: ReverbParams
  /** Master limiter threshold (dB). */
  limiterThreshold: number
}

/** High-level "one knob" performance macros, each 0 .. 1. */
export interface Macros {
  glow: number
  motion: number
  air: number
  grit: number
}

/** Arpeggiator configuration. */
export interface ArpConfig {
  enabled: boolean
  mode: 'up' | 'down' | 'updown' | 'random'
  division: number
  gate: number
  swing: number
  octaves: number
}

/** How a single played key expands into multiple notes. */
export type ChordMode = 'off' | 'unison' | 'fifth' | 'octave' | 'triad'

/** A recorded note-on/off within a phrase, in beat time. */
export interface PhraseEvent {
  time: number
  type: 'on' | 'off'
  degree: number
  octave: number
  expression?: TouchExpression
}

/** A captured performance loop. */
export interface Phrase {
  events: PhraseEvent[]
  lengthBeats: number
}

/** Web MIDI routing configuration. */
export interface MidiConfig {
  inEnabled: boolean
  outEnabled: boolean
  outChannel: number
  /**
   * MPE output: when true, each voice sends on its own member channel with a
   * per-note pitch bend, so a microtuning's exact (non-12-TET) pitches reach
   * external gear. When false, notes go out on {@link outChannel} rounded to the
   * nearest 12-TET note. Ignored for MIDI-in.
   */
  mpe: boolean
}

/**
 * Commands sent from the main thread to the audio worklet. Validated at the
 * boundary before dispatch; the worklet trusts the parsed shape.
 */
export type WorkletCommand =
  | { type: 'noteOn'; id: number; midi: number; velocity: number; freq?: number }
  | { type: 'noteOff'; id: number }
  | { type: 'expression'; id: number; expr: TouchExpression }
  | { type: 'setParam'; path: string; value: number }
  | { type: 'setPatch'; patch: PatchParams }
  | { type: 'setTempo'; bpm: number }
  | { type: 'panic' }

/** Schema version for persisted/shared {@link Session} payloads. Bump on breaking changes. */
export const SESSION_VERSION = 1

/**
 * Documented local-tempo range (BPM). The same bounds the transport clamps to;
 * the sanitizer uses them so a stored/shared/imported BPM is always in range.
 */
export const MIN_BPM = 20
export const MAX_BPM = 999
/** Default local tempo for fresh sessions and older payloads that predate stored BPM. */
export const DEFAULT_BPM = 120

/** The complete, serialisable instrument state. */
export interface Session {
  version: number
  name: string
  /**
   * Local tempo in BPM ({@link MIN_BPM}..{@link MAX_BPM}). Persisted so a phrase
   * recorded at one tempo reloads/shares at that tempo. Ableton Link may override
   * the *effective* tempo while enabled (§2) without overwriting this stored value.
   * Additive field: payloads predating it decode to {@link DEFAULT_BPM}.
   */
  bpm: number
  keyRoot: PitchClass
  mode: Mode
  /**
   * Optional microtuning. When absent the instrument is pure 12-TET and every
   * note-on omits `freq` (regression-identical). When present, surface degrees
   * index this tuning's `scaleCents` directly (arbitrary N, non-octave periods),
   * and the resolved per-note frequency is sent to the worklet. `keyRoot`/`mode`
   * still choose the diatonic surface layout but do not affect tuned pitch.
   */
  tuning?: PortableTuning
  /**
   * Optional Scala `.kbm` keyboard map for MIDI-in routing (§3-A). When present
   * (and a tuning is active) incoming MIDI notes route through it instead of the
   * linear degree map; absent → linear. Only meaningful alongside `tuning`.
   */
  keyboardMap?: KeyboardMap
  surface: SurfaceConfig
  patch: PatchParams
  fx: FxParams
  /** Master output level 0..1, applied to the engine's master gain node. */
  masterVolume: number
  /** Pre-FX input gain 0..2 (unity 1), applied between the synth and FX chain. */
  inputGain: number
  macros: Macros
  arp: ArpConfig
  chordMode: ChordMode
  midi: MidiConfig
  phrase: Phrase | null
  presetName?: string
}
