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
import { SCALE_TABLE, degreeToMidi, midiToNearestDegree } from '../harmony/scales'
import { buildGrid } from '../surface/geometry'
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
import { parseMidiMessage } from '../midi/parse'
import { NoteOwnership } from '../midi/ownership'
import * as db from '../persistence/db'
import { defaultSession, sanitizeSession } from '../persistence/session'
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
  private readonly midiInVoices = new Map<number, number>()
  private midiBend = 0
  private midiMod = 0

  private linkEnabledFlag = false
  private linkState: LinkState = getLinkState()
  private linkUnsub: (() => void) | null = null

  private savedSessions: SavedSessionMeta[] = []

  // --- voice bookkeeping ---
  private readonly voices = new Map<number, VoiceRecord>()
  private nextVoiceId = 1
  private nextEngineId = 1
  private readonly pending = new Set<ReturnType<typeof setTimeout>>()

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
      setKeyRoot: this.setKeyRoot,
      setMode: this.setMode,
      setLayout: this.setLayout,
      bpm: this.bpm,
      effectiveBpm: this.computeEffectiveBpm(),
      setBpm: this.setBpm,
      tapTempo: this.tapTempo,
      updatePatch: this.updatePatch,
      setMacro: this.setMacro,
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

      this.startedFlag = true
      this.emit()
    })()
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

  setLayout = (layout: Session['surface']['layout']): void => {
    this.releaseAll()
    this.session = { ...this.session, surface: { ...this.session.surface, layout } }
    this.rebuildGrid()
    this.autosave()
    this.emit()
  }

  private rebuildGrid(): void {
    const scaleLen = SCALE_TABLE[this.session.mode].length
    const coords = buildGrid(this.session.surface, scaleLen)
    const root = this.session.keyRoot
    const mode = this.session.mode
    this.grid = coords.map((row) =>
      row.map((c): GridCell => {
        const midi = degreeToMidi(c.degree, root, mode, c.octave)
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
    this.session = { ...this.session, arp }
    if (arp.enabled) {
      this.rebuildArp()
    } else {
      this.arpScheduler.stop()
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

  noteOnAt = (indexInScale: number, octave: number, expr: TouchExpression): number => {
    void this.ensureStarted()
    const { baseMidi, midis } = this.chordMidis(indexInScale, octave)

    // Latch toggle: re-pressing a latched-but-released note turns it off.
    if (this.latchOn) {
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
      for (const m of midis) {
        const eid = this.nextEngineId++
        rec.engineIds.push(eid)
        this.engine.noteOn(eid, m, vel)
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
    this.arpScheduler.stop()
    this.engine.panic()
    this.midiPanic()
    this.midiInVoices.clear()
    this.phraseVoiceIds.clear()
  }

  private chordMidis(indexInScale: number, octave: number): { baseMidi: number; midis: number[] } {
    const scaleLen = SCALE_TABLE[this.session.mode].length
    const degrees = chordDegrees(indexInScale, this.session.chordMode, scaleLen)
    const midis = degrees.map((d) => degreeToMidi(d, this.session.keyRoot, this.session.mode, octave))
    return { baseMidi: midis[0], midis }
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
    const arp = this.session.arp
    if (!arp.enabled) {
      this.arpScheduler.stop()
      return
    }
    const midis = this.arpMidis()
    if (midis.length === 0) {
      this.arpScheduler.stop()
      return
    }
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
    for (const ev of events) {
      const eid = this.nextEngineId++
      this.scheduleAt(ev.time, () => {
        this.engine.noteOn(eid, ev.note, ev.velocity)
        this.midiSendNoteOn(eid, ev.note, ev.velocity)
      })
      this.scheduleAt(ev.offTime, () => {
        this.engine.noteOff(eid)
        this.midiSendNoteOff(eid)
      })
    }
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
      const lengthBeats = Math.max(BEATS_PER_BAR, Math.ceil(maxBeat / BEATS_PER_BAR) * BEATS_PER_BAR)
      this.session = { ...this.session, phrase: { events, lengthBeats } }
      this.recorderState = 'idle'
      this.autosave()
      this.emit()
      return
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
        pitch: degreeToMidi(on.degree, this.session.keyRoot, this.session.mode, on.octave),
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
        holder.id = this.noteOnAt(meta.degree, meta.octave, meta.expr)
        this.phraseVoiceIds.add(holder.id)
      })
      this.scheduleAt(ev.offTime, () => {
        if (holder.id >= 0) {
          this.noteOffVoice(holder.id)
          this.phraseVoiceIds.delete(holder.id)
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
        const { index, octave } = this.midiToCell(ev.note)
        const vId = this.noteOnAt(index, octave, {
          pitch: ev.note,
          glide: 0,
          timbre: this.midiMod,
          pressure: ev.velocity / 127,
        })
        this.midiInVoices.set(ev.note, vId)
        break
      }
      case 'noteOff': {
        const vId = this.midiInVoices.get(ev.note)
        if (vId !== undefined) {
          this.noteOffVoice(vId)
          this.midiInVoices.delete(ev.note)
        }
        break
      }
      case 'pitchBend': {
        this.midiBend = ev.value
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

  /** Map an incoming MIDI note to a scale cell in the active key/mode. */
  private midiToCell(note: number): { index: number; octave: number } {
    const len = SCALE_TABLE[this.session.mode].length
    const degree = midiToNearestDegree(note, this.session.keyRoot, this.session.mode)
    const index = ((degree % len) + len) % len
    const octave = this.session.surface.baseOctave + Math.floor(degree / len)
    return { index, octave }
  }

  /** Fold the latest pitch-bend + mod-wheel into every MIDI-input voice. */
  private applyMidiExpression(): void {
    for (const [note, vId] of this.midiInVoices) {
      const v = this.voices.get(vId)
      if (!v) continue
      this.moveVoice(vId, {
        pitch: note + this.midiBend * 2,
        glide: 0,
        timbre: this.midiMod,
        pressure: v.expr.pressure,
      })
    }
  }

  private midiSendNoteOn(engineId: number, midi: number, velocity: number): void {
    if (!this.session.midi.outEnabled || !this.midiAccess) return
    const channel = this.session.midi.outChannel - 1
    this.sendMidi(this.ownership.noteOn(engineId, midi, Math.round(clamp01(velocity) * 127), channel))
  }

  private midiSendNoteOff(engineId: number): void {
    if (!this.midiAccess) return
    // Always flush a tracked off, even if output was toggled off mid-note.
    this.sendMidi(this.ownership.noteOff(engineId))
  }

  private midiPanic(): void {
    if (!this.midiAccess) return
    this.sendMidi(this.ownership.panic())
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

  // ------------------------------------------------------------------ autosave

  private autosave(): void {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer)
    this.autosaveTimer = setTimeout(() => {
      void db.putAutosave(this.session)
    }, 500)
  }
}

/** The one process-wide instrument store. */
export const instrumentStore = new InstrumentStore()
