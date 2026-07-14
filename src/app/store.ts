/**
 * store — the imperative integration spine behind `useInstrument`.
 *
 * A single module-level singleton that owns the real-time machinery (one
 * {@link AudioEngine}, two lookahead {@link Scheduler}s for arp + phrase, Web
 * MIDI I/O, the Ableton Link bridge) and the serialisable {@link Session}. React
 * only ever *reads* an immutable snapshot of this store through
 * `useSyncExternalStore`; every note, every timer and every AudioContext call is
 * driven here, off the render path.
 *
 * Design notes
 * ------------
 * - Timing lives on the audio clock: schedulers plan a small window ahead against
 *   `AudioContext.currentTime` (read via the master gain's context), then fire
 *   each note with a `setTimeout` sized to the remaining delay. The synth worklet
 *   plays notes immediately on message, so wall-clock firing against the ctx
 *   clock is the accurate path here.
 * - No hung voices: every note-on is paired with a release; panic / key change /
 *   mode change / layout change flush everything (engine + MIDI + timers).
 * - All boundary inputs (MIDI bytes, Link messages, loaded sessions) are
 *   validated by the pure modules they pass through before reaching the engine.
 */

import type {
  ArpConfig,
  ChordMode,
  Macros,
  MidiConfig,
  Mode,
  PatchParams,
  Phrase,
  PhraseEvent,
  PitchClass,
  PortableTuning,
  Session,
  TouchExpression,
} from '../types'
import type {
  GridCell,
  Instrument,
  LinkStatus,
  RecorderState,
  RecorderStatus,
  SavedSessionMeta,
} from '../components/instrument'
import { AudioEngine, getPreset } from '../audio'
import { REFERENCE_OCTAVE, SCALE_TABLE, degreeToMidi, midiToNearestDegree } from '../harmony/scales'
import { BUILTIN_PORTABLE_TUNINGS, DEFAULT_TONIC_HZ, degreeOctaveToHz, freqToMidi, importSclText, midiToTunedCell, normalizeTuning, scaleLengthOf } from '../harmony/tuning'
import { parseKbm } from '../vendor/tuning-core/scala'
import { buildGrid, effectiveSurface } from '../surface/geometry'
import { Scheduler, type PatternEvent, type PlannedEvent } from '../transport/scheduler'
import { secondsPerBeat } from '../transport/clock'
import { generateArpSequence } from '../transport/arp'
import {
  autoDetectLinkBridge,
  enableLinkBridge,
  getLinkState,
  onLinkState,
  sendLinkTempo,
  type LinkState,
} from '../transport/linkBridge'
import {
  createMbusClient,
  type MbusClient,
  type Publication,
} from '../transport/mbus'
import { parseMidiMessage } from '../midi/parse'
import { NoteOwnership } from '../midi/ownership'
import { pitchBendBytes } from '../midi/emit'
import { bendForSemitones, MpeAllocator } from '../midi/mpe'
import * as db from '../persistence/db'
import {
  MAX_PHRASE_EVENTS,
  MAX_PHRASE_LENGTH_BEATS,
  defaultSession,
  sanitizeSession,
} from '../persistence/session'
import { sessionFromUrl } from '../sharing/codec'

/** Fixed seed so a given held chord always arpeggiates identically (share-safe). */
const ARP_SEED = 0x6d6b6579 // "mkey"
/** Beats per bar assumed by the recorder + phrase player (bridge is 4/4-only). */
const BEATS_PER_BAR = 4
/** Fallback velocity (0..1) when a touch reports no pressure. */
const DEFAULT_VELOCITY = 0.85
/** Arpeggiator note velocity (0..1). */
const ARP_VELOCITY = 0.85
/** Lookahead + tick for both schedulers (seconds / ms). */
const SCHED_LOOKAHEAD = 0.12
const SCHED_INTERVAL = 25

/** 12-TET frequency of a (possibly fractional) MIDI note; A4 = 69 = 440 Hz. */
const midiToFreqHz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12)

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n)
const clampInt = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Math.round(n)))

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

/** Spell an absolute MIDI note as a sharp note name, e.g. 60 → "C4". */
function noteName(midi: number): string {
  const rounded = Math.round(midi)
  const pc = ((rounded % 12) + 12) % 12
  const octave = Math.floor(rounded / 12) - 1
  return `${NOTE_NAMES[pc]}${octave}`
}

/**
 * Expand one scale degree into the degrees a chord mode sounds. Offsets are in
 * scale steps: a fifth is +4 steps (do→sol), a triad adds the third (+2) and
 * fifth (+4), and octave stacks a full scale length up.
 */
function chordDegrees(base: number, mode: ChordMode, scaleLen: number): number[] {
  switch (mode) {
    case 'fifth':
      return [base, base + 4]
    case 'octave':
      return [base, base + scaleLen]
    case 'triad':
      return [base, base + 2, base + 4]
    case 'off':
    case 'unison':
    default:
      // 'unison' thickening is handled by the synth's unison voices, not by
      // stacking extra logical notes.
      return [base]
  }
}

const uuid = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`

const nowSeconds = (): number =>
  typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000

/** A live logical voice (one played key), which may sound several engine notes. */
interface VoiceRecord {
  id: number
  indexInScale: number
  octave: number
  baseMidi: number
  /** Expanded chord MIDI notes (parallel to {@link engineIds} for direct play). */
  midis: number[]
  /** Engine voice ids for direct play; empty when the voice is routed to the arp. */
  engineIds: number[]
  arp: boolean
  /** Whether a finger/key is currently down (false = latch-held after release). */
  fingerDown: boolean
  expr: TouchExpression
}

/** Resolved on-event data for phrase playback (indexed by PatternEvent.note). */
interface PhraseMeta {
  degree: number
  octave: number
  expr: TouchExpression
}

class InstrumentStore {
  private readonly engine = new AudioEngine()
  private readonly arpScheduler: Scheduler
  private readonly phraseScheduler: Scheduler

  private session: Session
  private grid: readonly (readonly GridCell[])[] = []

  private startedFlag = false
  private startPromise: Promise<void> | null = null
  private loadedFromUrl = false

  private bpm = 120
  private taps: number[] = []
  private latchOn = false

  private recorderState: RecorderState = 'idle'
  private recordStartCtx = 0
  private recordedEvents: PhraseEvent[] = []

  private masterRecordingFlag = false

  private midiReadyFlag = false
  private midiAccess: MIDIAccess | null = null
  private readonly ownership = new NoteOwnership()
  /** Per-voice member-channel assignment for MPE output (§4, microtonal note-out). */
  private readonly mpeAlloc = new MpeAllocator()
  private readonly midiInVoices = new Map<number, { vId: number; channel: number }>()
  /** Latest pitch-bend per source channel, so MPE per-note bends stay independent. */
  private readonly midiBend = new Map<number, number>()
  private midiMod = 0

  private linkEnabledFlag = false
  private linkState: LinkState = getLinkState()
  private linkUnsub: (() => void) | null = null

  // mbus publish: offer the master output to the mbus patchbay over the local
  // link-bridge (see src/transport/mbus). Off by default; until enabled no
  // client exists and no socket is opened. Session-transient on purpose, like
  // linkEnabledFlag.
  private mbus: MbusClient | null = null
  private mbusPub: Publication | null = null
  private mbusPublishWanted = false

  private savedSessions: SavedSessionMeta[] = []

  // --- voice bookkeeping ---
  private readonly voices = new Map<number, VoiceRecord>()
  private nextVoiceId = 1
  private nextEngineId = 1
  private readonly pending = new Set<ReturnType<typeof setTimeout>>()
  // Arp timers/notes are tracked apart from `pending` so stopping the arp can
  // cancel its still-scheduled note-ons and silence its sounding notes without
  // touching phrase playback.
  private readonly arpPending = new Set<ReturnType<typeof setTimeout>>()
  private readonly arpLive = new Set<number>()

  // --- phrase playback ---
  private phraseTable: PhraseMeta[] = []
  private readonly phraseVoiceIds = new Set<number>()

  private autosaveTimer: ReturnType<typeof setTimeout> | null = null

  private readonly listeners = new Set<() => void>()
  private current!: Instrument

  constructor() {
    const fromUrl = typeof location !== 'undefined' ? sessionFromUrl(location.href) : null
    this.loadedFromUrl = fromUrl !== null
    this.session = fromUrl ?? defaultSession()

    this.arpScheduler = new Scheduler({
      now: () => this.ctxNow(),
      onEvents: (events) => this.onArpEvents(events),
      lookahead: SCHED_LOOKAHEAD,
      interval: SCHED_INTERVAL,
    })
    this.phraseScheduler = new Scheduler({
      now: () => this.ctxNow(),
      onEvents: (events) => this.onPhraseEvents(events),
      lookahead: SCHED_LOOKAHEAD,
      interval: SCHED_INTERVAL,
    })

    this.rebuildGrid()
    this.buildSnapshot()
  }

  // ------------------------------------------------------------------ store I/O

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): Instrument => this.current

  private emit(): void {
    this.buildSnapshot()
    for (const l of this.listeners) l()
  }

  private buildSnapshot(): void {
    const active = new Map<number, { midi: number }>()
    for (const [id, v] of this.voices) active.set(id, { midi: v.baseMidi })
    const link: LinkStatus = {
      enabled: this.linkEnabledFlag,
      connected: this.linkState.connected,
      peers: this.linkState.peers,
    }
    this.current = {
      session: this.session,
      started: this.startedFlag,
      start: this.start,
      panic: this.panic,
      latencyMs: this.engine.latencyMs(),
      setKeyRoot: this.setKeyRoot,
      setMode: this.setMode,
      setTuning: this.setTuning,
      setTonic: this.setTonic,
      importSclFile: this.importSclFile,
      importKbmFile: this.importKbmFile,
      setLayout: this.setLayout,
      bpm: this.bpm,
      effectiveBpm: this.computeEffectiveBpm(),
      setBpm: this.setBpm,
      tapTempo: this.tapTempo,
      updatePatch: this.updatePatch,
      setMacro: this.setMacro,
      setMasterVolume: this.setMasterVolume,
      setInputGain: this.setInputGain,
      loadPreset: this.loadPreset,
      setArp: this.setArp,
      setChordMode: this.setChordMode,
      latch: this.latchOn,
      setLatch: this.setLatch,
      recorder: this.recorderStatus(),
      toggleRecordPhrase: this.toggleRecordPhrase,
      togglePlayPhrase: this.togglePlayPhrase,
      clearPhrase: this.clearPhrase,
      savedSessions: this.savedSessions,
      saveSession: this.saveSession,
      loadSession: this.loadSession,
      deleteSession: this.deleteSession,
      applySession: this.applySession,
      masterRecording: this.masterRecordingFlag,
      startMasterRecord: this.startMasterRecord,
      stopMasterRecord: this.stopMasterRecord,
      midiReady: this.midiReadyFlag,
      setMidiConfig: this.setMidiConfig,
      enableMidi: this.enableMidi,
      link,
      toggleLink: this.toggleLink,
      mbusPublishing: this.mbusPublishWanted,
      toggleMbusPublish: this.toggleMbusPublish,
      grid: this.grid,
      noteOnAt: this.noteOnAt,
      moveVoice: this.moveVoice,
      noteOffVoice: this.noteOffVoice,
      activeVoices: active,
    }
  }

  // ------------------------------------------------------------------ lifecycle

  start = (): Promise<void> => {
    if (this.startedFlag) return Promise.resolve()
    if (this.startPromise) return this.startPromise
    this.startPromise = (async () => {
      await this.engine.start()
      // Prefer an autosave only when no share link seeded the session.
      if (!this.loadedFromUrl) {
        const saved = await db.getAutosave()
        if (saved) {
          this.session = saved
          this.rebuildGrid()
        }
      }
      this.engine.setPatch(this.session.patch)
      this.engine.setFx(this.session.fx)
      this.engine.setMacros(this.session.macros)
      this.engine.setMasterVolume(this.session.masterVolume)
      this.engine.setInputGain(this.session.inputGain)
      this.applyTempo()

      // start() is idempotent — drop any prior subscription before re-subscribing.
      this.linkUnsub?.()
      this.linkUnsub = onLinkState((s) => this.onLink(s))
      autoDetectLinkBridge()

      if (this.session.midi.inEnabled || this.session.midi.outEnabled) {
        void this.enableMidi()
      }
      void this.refreshSavedSessions()

      if (this.session.arp.enabled) this.rebuildArp()

      // Publish intent recorded before the engine existed (toggle pre-start).
      this.applyMbusPublish()

      this.startedFlag = true
      this.emit()
    })()
    // Clear a rejected start so a later tap can retry (some browsers need a
    // second gesture); without this the cached rejection is returned forever.
    this.startPromise.catch(() => {
      this.startPromise = null
    })
    return this.startPromise
  }

  private ensureStarted(): Promise<void> {
    if (this.startedFlag) return Promise.resolve()
    return this.start()
  }

  private ctxNow(): number {
    const ctx = this.engine.masterGain?.context
    return ctx ? ctx.currentTime : nowSeconds()
  }

  panic = (): void => {
    this.releaseAll()
    this.phraseScheduler.stop()
    if (this.recorderState === 'playing') this.recorderState = 'idle'
    this.emit()
  }

  // ------------------------------------------------------------------ musical

  setKeyRoot = (pc: PitchClass): void => {
    this.releaseAll()
    this.session = { ...this.session, keyRoot: clampInt(pc, 0, 11) }
    this.rebuildGrid()
    this.autosave()
    this.emit()
  }

  setMode = (mode: Mode): void => {
    this.releaseAll()
    this.session = { ...this.session, mode }
    this.rebuildGrid()
    this.autosave()
    this.emit()
  }

  /**
   * Load a microtuning (arbitrary N, non-octave periods) or clear back to
   * 12-TET (`null`). Changing the scale length relays the surface, and the pitch
   * change means every sounding note must be released first.
   */
  setTuning = (tuning: PortableTuning | null): void => {
    this.releaseAll()
    const next: Session = { ...this.session }
    if (tuning) next.tuning = normalizeTuning(tuning)
    else delete next.tuning
    // A keyboard map is bound to a specific scale layout; a new (or cleared)
    // tuning invalidates it. A subsequent .kbm import re-attaches one.
    delete next.keyboardMap
    this.session = next
    this.rebuildGrid()
    this.autosave()
    this.emit()
  }

  /**
   * Import a Scala `.scl` scale file and make it the active tuning (§4). The
   * tonic pitch is inherited from the current tuning, else the shared default.
   * Throws (via the vendored parser) on malformed input — the UI catches it.
   */
  importSclFile = (text: string): void => {
    const tonicHz = this.session.tuning?.tonicHz ?? DEFAULT_TONIC_HZ
    this.setTuning(importSclText(text, tonicHz))
  }

  /**
   * Import a Scala `.kbm` keyboard map (§4): its reference frequency retunes
   * the active tuning's tonic, and its per-key degree list becomes the MIDI-in
   * map (§3-A). Requires an active tuning (a `.kbm` carries no scale of its
   * own). Throws on malformed input.
   */
  importKbmFile = (text: string): void => {
    const kbm = parseKbm(text)
    // A .kbm carries no scale; apply it over the active tuning, or establish a
    // 12-TET one so the map is honoured even from the standard state.
    const base = this.session.tuning ?? BUILTIN_PORTABLE_TUNINGS[0]
    this.releaseAll()
    this.session = {
      ...this.session,
      tuning: normalizeTuning({ ...base, tonicHz: kbm.refFreq }),
      keyboardMap: { refNote: kbm.refNote, degrees: [...kbm.degrees] },
    }
    this.rebuildGrid()
    this.autosave()
    this.emit()
  }

  /**
   * Retune the active tuning's tonic (reference pitch in Hz). No-op without a
   * tuning (12-TET has no adjustable tonic). Preserves any loaded `.kbm` map —
   * only the reference frequency moves. Sounding notes are released first.
   */
  setTonic = (tonicHz: number): void => {
    const t = this.session.tuning
    if (!t) return
    const hz = tonicHz < 20 ? 20 : tonicHz > 4000 ? 4000 : tonicHz
    this.releaseAll()
    this.session = { ...this.session, tuning: normalizeTuning({ ...t, tonicHz: hz }) }
    this.rebuildGrid()
    this.autosave()
    this.emit()
  }

  setLayout = (layout: Session['surface']['layout']): void => {
    this.releaseAll()
    this.session = { ...this.session, surface: { ...this.session.surface, layout } }
    this.rebuildGrid()
    this.autosave()
    this.emit()
  }

  /**
   * Steps per period of the active scale: the tuning's own length when one is
   * loaded (so a 19-note tuning lays out 19 columns per octave), else the
   * diatonic mode's length. The surface geometry is built against this.
   */
  private scaleLen(): number {
    const t = this.session.tuning
    return t ? scaleLengthOf(t) : SCALE_TABLE[this.session.mode].length
  }

  /**
   * Resolve a surface (degree, octave) to the note-on pitch. Without a tuning
   * this is the plain 12-TET MIDI note and no `freq` (worklet stays 12-TET —
   * regression-identical). With a tuning, `freq` is the resolved Hz and `midi`
   * its fractional 12-TET anchor (freqToMidi), which keeps the expression /
   * glide / MIDI machinery — all MIDI-space — consistent with the sounding
   * pitch: a bend of one MIDI semitone is one semitone around the tuned note.
   */
  private resolvePitch(degree: number, octave: number): { midi: number; freq?: number } {
    const t = this.session.tuning
    if (!t) {
      return { midi: degreeToMidi(degree, this.session.keyRoot, this.session.mode, octave) }
    }
    const freq = degreeOctaveToHz(t, degree, octave)
    return { midi: freqToMidi(freq), freq }
  }

  private rebuildGrid(): void {
    const coords = buildGrid(effectiveSurface(this.session.surface), this.scaleLen())
    this.grid = coords.map((row) =>
      row.map((c): GridCell => {
        const { midi } = this.resolvePitch(c.degree, c.octave)
        return {
          degree: c.degree,
          octave: c.octave,
          midi,
          label: noteName(midi),
          indexInScale: c.degree,
          isTonic: c.degree === 0,
        }
      }),
    )
  }

  // ------------------------------------------------------------------ tempo

  private computeEffectiveBpm(): number {
    return this.linkState.connected ? this.linkState.tempo : this.bpm
  }

  private applyTempo(): void {
    const eb = this.computeEffectiveBpm()
    this.engine.setTempo(eb)
    this.arpScheduler.setTempo(eb)
    this.phraseScheduler.setTempo(eb)
  }

  setBpm = (bpm: number): void => {
    this.bpm = Math.min(999, Math.max(20, bpm))
    if (!this.linkState.connected) {
      this.applyTempo()
      sendLinkTempo(this.bpm)
    }
    this.emit()
  }

  tapTempo = (): void => {
    const t = nowSeconds()
    this.taps = this.taps.filter((prev) => t - prev < 2)
    this.taps.push(t)
    if (this.taps.length >= 2) {
      let sum = 0
      for (let i = 1; i < this.taps.length; i++) sum += this.taps[i] - this.taps[i - 1]
      const avg = sum / (this.taps.length - 1)
      if (avg > 0) this.setBpm(60 / avg)
    }
  }

  // ------------------------------------------------------------------ sound

  updatePatch = (patch: PatchParams): void => {
    this.session = { ...this.session, patch, presetName: undefined }
    this.engine.setPatch(patch)
    // Re-apply macros so a manual patch edit doesn't drop macro overrides.
    this.engine.setMacros(this.session.macros)
    this.autosave()
    this.emit()
  }

  setMacro = (name: keyof Macros, value: number): void => {
    const macros: Macros = { ...this.session.macros, [name]: clamp01(value) }
    this.session = { ...this.session, macros }
    this.engine.setMacros(macros)
    this.autosave()
    this.emit()
  }

  setMasterVolume = (v: number): void => {
    const masterVolume = clamp01(v)
    this.session = { ...this.session, masterVolume }
    this.engine.setMasterVolume(masterVolume)
    this.autosave()
    this.emit()
  }

  setInputGain = (v: number): void => {
    const inputGain = v < 0 ? 0 : v > 2 ? 2 : v
    this.session = { ...this.session, inputGain }
    this.engine.setInputGain(inputGain)
    this.autosave()
    this.emit()
  }

  loadPreset = (name: string): void => {
    const preset = getPreset(name)
    if (!preset) return
    const fx = { ...this.session.fx, ...(preset.fx ?? {}) }
    const macros = preset.macros ?? this.session.macros
    this.session = { ...this.session, patch: preset.patch, fx, macros, presetName: name }
    this.engine.setPatch(preset.patch)
    this.engine.setFx(fx)
    this.engine.setMacros(macros)
    this.autosave()
    this.emit()
  }

  // ------------------------------------------------------------------ performance

  setArp = (arp: ArpConfig): void => {
    const wasEnabled = this.session.arp.enabled
    this.session = { ...this.session, arp }
    if (arp.enabled) {
      // Fold any directly-sounding notes into the arp so they don't drone on
      // alongside the sequence when it turns on.
      if (!wasEnabled) {
        for (const v of this.voices.values()) {
          if (!v.arp) {
            for (const eid of v.engineIds) {
              this.engine.noteOff(eid)
              this.midiSendNoteOff(eid)
            }
            v.engineIds = []
            v.arp = true
          }
        }
      }
      this.rebuildArp()
    } else {
      this.stopArp()
      for (const [id, v] of [...this.voices]) if (v.arp) this.voices.delete(id)
    }
    this.autosave()
    this.emit()
  }

  setChordMode = (mode: ChordMode): void => {
    this.session = { ...this.session, chordMode: mode }
    this.autosave()
    this.emit()
  }

  setLatch = (on: boolean): void => {
    this.latchOn = on
    if (!on) {
      // Releasing latch drops every note whose finger is already up.
      for (const [id, v] of [...this.voices]) if (!v.fingerDown) this.releaseVoice(id)
    }
    this.emit()
  }

  // ------------------------------------------------------------------ note routing

  noteOnAt = (
    indexInScale: number,
    octave: number,
    expr: TouchExpression,
    opts?: { bypassLatch?: boolean },
  ): number => {
    void this.ensureStarted()
    const { baseMidi, midis, freqs } = this.chordMidis(indexInScale, octave)

    // Latch toggle: re-pressing a latched-but-released note turns it off. Phrase
    // playback bypasses this so a looped note never toggles a held latch note.
    if (this.latchOn && !opts?.bypassLatch) {
      for (const [id, v] of this.voices) {
        if (!v.fingerDown && v.baseMidi === baseMidi) {
          this.releaseVoice(id)
          this.emit()
          return id
        }
      }
    }

    const id = this.nextVoiceId++
    const vel = expr.pressure > 0 ? clamp01(expr.pressure) : DEFAULT_VELOCITY
    const useArp = this.session.arp.enabled
    const rec: VoiceRecord = {
      id,
      indexInScale,
      octave,
      baseMidi,
      midis,
      engineIds: [],
      arp: useArp,
      fingerDown: true,
      expr,
    }

    if (useArp) {
      this.voices.set(id, rec)
      this.rebuildArp()
    } else {
      for (let i = 0; i < midis.length; i++) {
        const m = midis[i]
        const eid = this.nextEngineId++
        rec.engineIds.push(eid)
        this.engine.noteOn(eid, m, vel, freqs?.[i])
        this.engine.setExpression(eid, this.exprForNote(expr, m, baseMidi))
        this.midiSendNoteOn(eid, m, vel)
      }
      this.voices.set(id, rec)
    }

    if (this.recorderState === 'recording') {
      this.captureEvent('on', indexInScale, octave, expr)
    }
    this.emit()
    return id
  }

  moveVoice = (voiceId: number, expr: TouchExpression): void => {
    const v = this.voices.get(voiceId)
    if (!v) return
    v.expr = expr
    if (!v.arp) {
      for (let i = 0; i < v.engineIds.length; i++) {
        this.engine.setExpression(v.engineIds[i], this.exprForNote(expr, v.midis[i], v.baseMidi))
      }
    }
    // No emit: the visible per-voice midi (baseMidi) is unchanged, so continuous
    // pointer moves never touch React.
  }

  noteOffVoice = (voiceId: number): void => {
    const v = this.voices.get(voiceId)
    if (!v) return
    if (this.latchOn) {
      // Keep sounding; the note is released later by re-press or clearing latch.
      v.fingerDown = false
      return
    }
    this.releaseVoice(voiceId)
    this.emit()
  }

  /** Silence a voice's engine notes + MIDI, record the off, and forget it. */
  private releaseVoice(voiceId: number): void {
    const v = this.voices.get(voiceId)
    if (!v) return
    if (v.arp) {
      this.voices.delete(voiceId)
      this.rebuildArp()
    } else {
      for (const eid of v.engineIds) {
        this.engine.noteOff(eid)
        this.midiSendNoteOff(eid)
      }
      this.voices.delete(voiceId)
    }
    if (this.recorderState === 'recording') {
      this.captureEvent('off', v.indexInScale, v.octave, v.expr)
    }
  }

  /** Flush every voice, timer and device — the single no-hung-notes guarantee. */
  private releaseAll(): void {
    for (const v of this.voices.values()) {
      if (!v.arp) {
        for (const eid of v.engineIds) {
          this.engine.noteOff(eid)
          this.midiSendNoteOff(eid)
        }
      }
    }
    this.voices.clear()
    this.clearPending()
    this.stopArp()
    this.engine.panic()
    this.midiPanic()
    this.midiInVoices.clear()
    this.phraseVoiceIds.clear()
  }

  private chordMidis(
    indexInScale: number,
    octave: number,
  ): { baseMidi: number; midis: number[]; freqs?: number[] } {
    const degrees = chordDegrees(indexInScale, this.session.chordMode, this.scaleLen())
    const resolved = degrees.map((d) => this.resolvePitch(d, octave))
    const midis = resolved.map((r) => r.midi)
    // Only carry frequencies when a tuning is active; otherwise the worklet
    // stays on its 12-TET midiToFreq path.
    const freqs = this.session.tuning ? resolved.map((r) => r.freq as number) : undefined
    return { baseMidi: midis[0], midis, freqs }
  }

  /** Offset a touch's absolute pitch so a stacked chord note glides in parallel. */
  private exprForNote(expr: TouchExpression, noteMidi: number, baseMidi: number): TouchExpression {
    return {
      pitch: expr.pitch + (noteMidi - baseMidi),
      glide: expr.glide,
      timbre: expr.timbre,
      pressure: expr.pressure,
    }
  }

  private clearPending(): void {
    for (const h of this.pending) clearTimeout(h)
    this.pending.clear()
  }

  private scheduleAt(timeSec: number, fn: () => void): void {
    const delayMs = Math.max(0, (timeSec - this.ctxNow()) * 1000)
    const h = setTimeout(() => {
      this.pending.delete(h)
      fn()
    }, delayMs)
    this.pending.add(h)
  }

  // ------------------------------------------------------------------ arp engine

  private arpMidis(): number[] {
    const set = new Set<number>()
    for (const v of this.voices.values()) if (v.arp) for (const m of v.midis) set.add(m)
    return [...set].sort((a, b) => a - b)
  }

  private rebuildArp(): void {
    // Fully reset first: cancel any note-ons still scheduled from the previous
    // sequence and silence its sounding notes, so a rebuild never leaves stale
    // or hung arp notes behind.
    this.stopArp()
    const arp = this.session.arp
    if (!arp.enabled) return
    const midis = this.arpMidis()
    if (midis.length === 0) return
    const seq = generateArpSequence(midis, arp, ARP_SEED)
    const stepBeats = BEATS_PER_BAR / Math.max(1, arp.division)
    const gate = Math.min(1, Math.max(0.05, arp.gate))
    const pattern: PatternEvent[] = seq.map((note, i) => ({
      beat: i * stepBeats,
      durationBeats: stepBeats * gate,
      note,
      velocity: ARP_VELOCITY,
    }))
    this.arpScheduler.setSwing(arp.swing)
    this.arpScheduler.setBeatsPerBar(BEATS_PER_BAR)
    this.arpScheduler.setPattern(pattern, seq.length * stepBeats)
    this.arpScheduler.setTempo(this.computeEffectiveBpm())
    if (!this.arpScheduler.playing) this.arpScheduler.start()
  }

  private onArpEvents(events: PlannedEvent[]): void {
    // Under a tuning the arp's note numbers are fractional 12-TET anchors that
    // losslessly encode the tuned Hz, so recover the frequency from them.
    const tuned = this.session.tuning != null
    for (const ev of events) {
      const eid = this.nextEngineId++
      const freq = tuned ? midiToFreqHz(ev.note) : undefined
      this.scheduleArpAt(ev.time, () => {
        this.engine.noteOn(eid, ev.note, ev.velocity, freq)
        this.midiSendNoteOn(eid, ev.note, ev.velocity)
        this.arpLive.add(eid)
      })
      this.scheduleArpAt(ev.offTime, () => {
        this.engine.noteOff(eid)
        this.midiSendNoteOff(eid)
        this.arpLive.delete(eid)
      })
    }
  }

  /** Like {@link scheduleAt} but tracked in `arpPending` so `stopArp` can cancel it. */
  private scheduleArpAt(timeSec: number, fn: () => void): void {
    const delayMs = Math.max(0, (timeSec - this.ctxNow()) * 1000)
    const h = setTimeout(() => {
      this.arpPending.delete(h)
      fn()
    }, delayMs)
    this.arpPending.add(h)
  }

  /** Stop the arp cleanly: no future note fires, no sounding note is left hung. */
  private stopArp(): void {
    this.arpScheduler.stop()
    for (const h of this.arpPending) clearTimeout(h)
    this.arpPending.clear()
    for (const eid of this.arpLive) {
      this.engine.noteOff(eid)
      this.midiSendNoteOff(eid)
    }
    this.arpLive.clear()
  }

  // ------------------------------------------------------------------ phrase recorder

  private recorderStatus(): RecorderStatus {
    const bars = this.session.phrase ? this.session.phrase.lengthBeats / BEATS_PER_BAR : 0
    return { state: this.recorderState, bars }
  }

  private captureEvent(
    type: PhraseEvent['type'],
    degree: number,
    octave: number,
    expr: TouchExpression,
  ): void {
    // Cap live captures so an unattended recording can't grow unbounded; the
    // same ceiling the import path enforces in sanitizePhrase.
    if (this.recordedEvents.length >= MAX_PHRASE_EVENTS) return
    const beat = (this.ctxNow() - this.recordStartCtx) / secondsPerBeat(this.computeEffectiveBpm())
    this.recordedEvents.push({
      time: Math.max(0, beat),
      type,
      degree,
      octave,
      expression: { ...expr },
    })
  }

  toggleRecordPhrase = (): void => {
    if (this.recorderState === 'recording') {
      const events = this.recordedEvents
      let maxBeat = 0
      for (const e of events) maxBeat = Math.max(maxBeat, e.time)
      const lengthBeats = Math.min(
        MAX_PHRASE_LENGTH_BEATS,
        Math.max(BEATS_PER_BAR, Math.ceil(maxBeat / BEATS_PER_BAR) * BEATS_PER_BAR),
      )
      this.session = { ...this.session, phrase: { events, lengthBeats } }
      this.recorderState = 'idle'
      this.autosave()
      this.emit()
      return
    }
    // If a phrase is playing, stop it first — otherwise the old loop keeps
    // sounding, bleeds into the take, and can no longer be stopped by Play/Stop.
    if (this.recorderState === 'playing') {
      this.phraseScheduler.stop()
      for (const id of [...this.phraseVoiceIds]) this.releaseVoice(id)
      this.phraseVoiceIds.clear()
    }
    void this.ensureStarted()
    this.recordedEvents = []
    this.recordStartCtx = this.ctxNow()
    this.recorderState = 'recording'
    this.emit()
  }

  togglePlayPhrase = (): void => {
    if (this.recorderState === 'playing') {
      this.phraseScheduler.stop()
      for (const id of [...this.phraseVoiceIds]) this.releaseVoice(id)
      this.phraseVoiceIds.clear()
      this.recorderState = 'idle'
      this.emit()
      return
    }
    const phrase = this.session.phrase
    if (!phrase || phrase.events.length === 0) return
    void this.ensureStarted()
    const { pattern, loopBeats } = this.buildPhrasePattern(phrase)
    if (pattern.length === 0) return
    this.phraseScheduler.setSwing(0)
    this.phraseScheduler.setBeatsPerBar(BEATS_PER_BAR)
    this.phraseScheduler.setPattern(pattern, loopBeats)
    this.phraseScheduler.setTempo(this.computeEffectiveBpm())
    this.phraseScheduler.start()
    this.recorderState = 'playing'
    this.emit()
  }

  clearPhrase = (): void => {
    this.phraseScheduler.stop()
    for (const id of [...this.phraseVoiceIds]) this.releaseVoice(id)
    this.phraseVoiceIds.clear()
    this.session = { ...this.session, phrase: null }
    if (this.recorderState === 'playing') this.recorderState = 'idle'
    this.autosave()
    this.emit()
  }

  /** Pair phrase on/off events into a loopable pattern + resolved side table. */
  private buildPhrasePattern(phrase: Phrase): { pattern: PatternEvent[]; loopBeats: number } {
    const table: PhraseMeta[] = []
    const pattern: PatternEvent[] = []
    const usedOff = new Set<number>()
    let maxBeat = 0

    phrase.events.forEach((on) => {
      if (on.type !== 'on') return
      // Match the earliest later off for the same cell that isn't already claimed.
      let offBeat: number | null = null
      for (let j = 0; j < phrase.events.length; j++) {
        const off = phrase.events[j]
        if (
          off.type === 'off' &&
          !usedOff.has(j) &&
          off.degree === on.degree &&
          off.octave === on.octave &&
          off.time >= on.time
        ) {
          usedOff.add(j)
          offBeat = off.time
          break
        }
      }
      const dur = offBeat !== null ? Math.max(0.05, offBeat - on.time) : 0.5
      const idx = table.length
      const expr: TouchExpression = on.expression ?? {
        // Anchor the default expression at the resolved note pitch (tuned or
        // 12-TET) so noteOnAt's initial bend offset is zero and playback is in tune.
        pitch: this.resolvePitch(on.degree, on.octave).midi,
        glide: 0,
        timbre: 0.5,
        pressure: DEFAULT_VELOCITY,
      }
      table.push({ degree: on.degree, octave: on.octave, expr })
      pattern.push({
        beat: on.time,
        durationBeats: dur,
        note: idx,
        velocity: on.expression?.pressure ?? DEFAULT_VELOCITY,
      })
      maxBeat = Math.max(maxBeat, on.time + dur)
    })

    this.phraseTable = table
    const loopBeats = phrase.lengthBeats > 0 ? phrase.lengthBeats : Math.max(BEATS_PER_BAR, maxBeat)
    return { pattern, loopBeats }
  }

  private onPhraseEvents(events: PlannedEvent[]): void {
    for (const ev of events) {
      const meta = this.phraseTable[ev.note]
      if (!meta) continue
      const holder = { id: -1 }
      this.scheduleAt(ev.time, () => {
        holder.id = this.noteOnAt(meta.degree, meta.octave, meta.expr, { bypassLatch: true })
        this.phraseVoiceIds.add(holder.id)
      })
      this.scheduleAt(ev.offTime, () => {
        if (holder.id >= 0) {
          // Release directly (not noteOffVoice): phrase notes must always end,
          // even with latch on, so a loop replays instead of accumulating.
          this.releaseVoice(holder.id)
          this.phraseVoiceIds.delete(holder.id)
          this.emit()
        }
      })
    }
  }

  // ------------------------------------------------------------------ session library

  private async refreshSavedSessions(): Promise<void> {
    const all = await db.list()
    this.savedSessions = all.map((r) => ({ id: r.id, name: r.session.name }))
    this.emit()
  }

  saveSession = async (name: string): Promise<void> => {
    const session: Session = { ...this.session, name }
    await db.put(uuid(), session)
    // The user has committed this session; autosave may resume for it.
    this.loadedFromUrl = false
    await this.refreshSavedSessions()
  }

  loadSession = async (id: string): Promise<void> => {
    const s = await db.get(id)
    if (s) this.applySession(s)
  }

  deleteSession = async (id: string): Promise<void> => {
    await db.del(id)
    await this.refreshSavedSessions()
  }

  applySession = (session: Session): void => {
    const s = sanitizeSession(session)
    // Loading a stored session replaces any URL-seeded one; autosave resumes.
    this.loadedFromUrl = false
    this.releaseAll()
    if (this.recorderState !== 'idle') {
      this.phraseScheduler.stop()
      this.recorderState = 'idle'
    }
    this.session = s
    this.rebuildGrid()
    if (this.startedFlag) {
      this.engine.setPatch(s.patch)
      this.engine.setFx(s.fx)
      this.engine.setMacros(s.macros)
      this.engine.setMasterVolume(s.masterVolume)
      this.engine.setInputGain(s.inputGain)
      this.applyTempo()
    }
    if (s.arp.enabled) this.rebuildArp()
    this.autosave()
    this.emit()
  }

  // ------------------------------------------------------------------ master capture

  startMasterRecord = async (): Promise<void> => {
    await this.ensureStarted()
    const rec = this.engine.getRecorder()
    if (!rec) return
    await rec.start()
    this.masterRecordingFlag = true
    this.emit()
  }

  stopMasterRecord = async (): Promise<void> => {
    const rec = this.engine.getRecorder()
    if (!rec) {
      this.masterRecordingFlag = false
      this.emit()
      return
    }
    const blob = await rec.stop()
    this.masterRecordingFlag = false
    this.emit()
    this.downloadBlob(blob, `mkeys-${Date.now()}.wav`)
  }

  private downloadBlob(blob: Blob, filename: string): void {
    if (typeof document === 'undefined' || typeof URL === 'undefined') return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // ------------------------------------------------------------------ MIDI

  enableMidi = async (): Promise<void> => {
    if (this.midiReadyFlag) return
    if (typeof navigator === 'undefined' || typeof navigator.requestMIDIAccess !== 'function') {
      this.midiReadyFlag = false
      this.emit()
      return
    }
    try {
      const access = await navigator.requestMIDIAccess()
      this.midiAccess = access
      this.midiReadyFlag = true
      this.wireMidiInputs()
      access.onstatechange = () => this.wireMidiInputs()
      this.emit()
    } catch {
      this.midiReadyFlag = false
      this.emit()
    }
  }

  private wireMidiInputs(): void {
    if (!this.midiAccess) return
    for (const input of this.midiAccess.inputs.values()) {
      input.onmidimessage = (e: MIDIMessageEvent) => this.handleMidiIn(e)
    }
  }

  private handleMidiIn(e: MIDIMessageEvent): void {
    if (!this.session.midi.inEnabled) return
    const data = e.data
    if (!data) return
    const ev = parseMidiMessage(data)
    if (!ev) return
    switch (ev.type) {
      case 'noteOn': {
        // A repeated note-on for a still-held note (chatty controller or a
        // dropped note-off) would otherwise orphan the previous voice.
        const held = this.midiInVoices.get(ev.note)
        if (held !== undefined) this.noteOffVoice(held.vId)
        const cell = this.midiToCell(ev.note)
        // A `.kbm` may leave this key unmapped — sound nothing (§3-A).
        if (!cell) break
        const { index, octave } = cell
        const vId = this.noteOnAt(index, octave, {
          // Anchor to the cell's resolved (micro)tuned pitch, not the raw
          // incoming note, so MIDI-in follows the active tuning like touch.
          pitch: this.resolvePitch(index, octave).midi,
          glide: 0,
          timbre: this.midiMod,
          pressure: ev.velocity / 127,
        })
        this.midiInVoices.set(ev.note, { vId, channel: ev.channel })
        break
      }
      case 'noteOff': {
        const held = this.midiInVoices.get(ev.note)
        if (held !== undefined) {
          this.noteOffVoice(held.vId)
          this.midiInVoices.delete(ev.note)
        }
        break
      }
      case 'pitchBend': {
        this.midiBend.set(ev.channel, ev.value)
        this.applyMidiExpression()
        break
      }
      case 'controlChange': {
        if (ev.kind === 'modWheel') {
          this.midiMod = clamp01(ev.value / 127)
          this.applyMidiExpression()
        } else if (ev.kind === 'sustain') {
          this.setLatch(ev.value >= 64)
        }
        break
      }
    }
  }

  /**
   * Map an incoming MIDI note to a scale cell (§3-A).
   *
   * Under an active tuning the diatonic SCALE_TABLE can't represent the scale
   * (it caps at 7 degrees and mistunes non-12-TET pitches), so route through the
   * tuning: honour a loaded `.kbm` keyboard map when present, else map notes to
   * successive degrees of the N-note scale. Returns `null` for a note a `.kbm`
   * leaves unmapped (the caller then sounds nothing). Without a tuning the
   * instrument stays pure 12-TET and the mapping is bit-identical to before.
   */
  private midiToCell(note: number): { index: number; octave: number } | null {
    const t = this.session.tuning
    if (t) {
      return midiToTunedCell(note, this.session.keyRoot, t, this.session.keyboardMap)
    }
    const len = SCALE_TABLE[this.session.mode].length
    const degree = midiToNearestDegree(note, this.session.keyRoot, this.session.mode)
    const index = ((degree % len) + len) % len
    // `degree` is anchored to REFERENCE_OCTAVE (the same reference the inverse
    // uses), so rebuild the octave from it — using surface.baseOctave here would
    // transpose incoming notes by (baseOctave − REFERENCE_OCTAVE) octaves.
    const octave = REFERENCE_OCTAVE + Math.floor(degree / len)
    return { index, octave }
  }

  /** Fold the latest pitch-bend + mod-wheel into every MIDI-input voice. */
  private applyMidiExpression(): void {
    for (const { vId, channel } of this.midiInVoices.values()) {
      const v = this.voices.get(vId)
      if (!v) continue
      this.moveVoice(vId, {
        // Bend rides on the voice's tuned base pitch, not the raw MIDI note,
        // using only the bend from the voice's own source channel (MPE).
        pitch: v.baseMidi + (this.midiBend.get(channel) ?? 0) * 2,
        glide: 0,
        timbre: this.midiMod,
        pressure: v.expr.pressure,
      })
    }
  }

  private midiSendNoteOn(engineId: number, midi: number, velocity: number): void {
    if (!this.session.midi.outEnabled || !this.midiAccess) return
    const vel = Math.round(clamp01(velocity) * 127)
    if (this.session.midi.mpe) {
      // MPE: own member channel per voice + a pitch bend carrying the fractional
      // (microtuning) offset, so each voice reaches its exact pitch independently.
      const { channel, evicted } = this.mpeAlloc.acquire(engineId)
      const note = Math.round(midi)
      const messages: number[][] = []
      // Steal happened (>15 voices): flush the evicted voice so it never hangs.
      if (evicted !== null) messages.push(...this.ownership.noteOff(evicted))
      // Bend before note-on so the note sounds in tune from its first sample.
      messages.push(pitchBendBytes(bendForSemitones(midi - note), channel))
      messages.push(...this.ownership.noteOn(engineId, note, vel, channel))
      this.sendMidi(messages)
      return
    }
    // Single-channel: `midi` may be a fractional tuned anchor; emit rounds it.
    const channel = this.session.midi.outChannel - 1
    this.sendMidi(this.ownership.noteOn(engineId, midi, vel, channel))
  }

  private midiSendNoteOff(engineId: number): void {
    if (!this.midiAccess) return
    // Always flush a tracked off, even if output was toggled off mid-note.
    this.sendMidi(this.ownership.noteOff(engineId))
    this.mpeAlloc.release(engineId)
  }

  private midiPanic(): void {
    if (!this.midiAccess) return
    this.sendMidi(this.ownership.panic())
    this.mpeAlloc.clear()
  }

  private sendMidi(messages: number[][]): void {
    if (!this.midiAccess || messages.length === 0) return
    for (const out of this.midiAccess.outputs.values()) {
      for (const m of messages) out.send(m)
    }
  }

  setMidiConfig = (next: MidiConfig): void => {
    const midi: MidiConfig = {
      inEnabled: !!next.inEnabled,
      outEnabled: !!next.outEnabled,
      outChannel: clampInt(next.outChannel, 1, 16),
      mpe: !!next.mpe,
    }
    // Switching output mode/channel remaps channels; flush first so no note hangs
    // on a channel we're about to stop tracking.
    const prev = this.session.midi
    if (midi.mpe !== prev.mpe || midi.outEnabled !== prev.outEnabled || midi.outChannel !== prev.outChannel) {
      this.midiPanic()
    }
    this.session = { ...this.session, midi }
    if ((midi.inEnabled || midi.outEnabled) && !this.midiReadyFlag) {
      void this.enableMidi()
    } else if (midi.inEnabled && this.midiAccess) {
      this.wireMidiInputs()
    }
    this.autosave()
    this.emit()
  }

  // ------------------------------------------------------------------ Link

  private onLink(state: LinkState): void {
    const wasConnected = this.linkState.connected
    this.linkState = state
    // Link owns tempo while connected; recompute + push downstream.
    this.applyTempo()
    if (wasConnected !== state.connected && !state.connected) {
      // Link dropped: fall back to local bpm cleanly.
      this.applyTempo()
    }
    this.emit()
  }

  toggleLink = (): void => {
    this.linkEnabledFlag = !this.linkEnabledFlag
    enableLinkBridge(this.linkEnabledFlag)
    this.emit()
  }

  // ------------------------------------------------------------------ mbus publish

  toggleMbusPublish = (): void => {
    this.mbusPublishWanted = !this.mbusPublishWanted
    this.applyMbusPublish()
    this.emit()
  }

  /** Reconcile the publish intent with the live graph. Enable is deferred until
   *  the engine is running (start() re-applies); disable unannounces the source
   *  and drops the bridge socket so "off" leaves nothing running. */
  private applyMbusPublish(): void {
    if (this.mbusPublishWanted) {
      const master = this.engine.masterGain
      if (!master || this.mbusPub) return
      this.mbus ??= createMbusClient()
      this.mbus.connect()
      this.mbusPub = this.mbus.publishOutput(master, 'mkeys')
    } else {
      this.mbusPub?.stop()
      this.mbusPub = null
      this.mbus?.disconnect()
    }
  }

  // ------------------------------------------------------------------ autosave

  private autosave(): void {
    // A session seeded from a share link must not clobber the recipient's own
    // autosave. Hold off until they explicitly save or load a session.
    if (this.loadedFromUrl) return
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer)
    this.autosaveTimer = setTimeout(() => {
      void db.putAutosave(this.session)
    }, 500)
  }
}

/** The one process-wide instrument store. */
export const instrumentStore = new InstrumentStore()
