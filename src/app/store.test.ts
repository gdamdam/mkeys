import { beforeEach, describe, expect, it } from 'vitest'
import type { TouchExpression } from '../types'
import { BUILTIN_PORTABLE_TUNINGS } from '../harmony/tuning'
import { instrumentStore } from './store'

/** A microtonal built-in (Just 5-limit) whose degrees deviate from 12-TET. */
const JUST = BUILTIN_PORTABLE_TUNINGS.find((t) => /just/i.test(t.name)) ?? BUILTIN_PORTABLE_TUNINGS[1]

/**
 * Structural view of the store's private MIDI-in internals so tests can feed
 * raw messages and inspect voice expression without widening the public API.
 */
interface StoreMidiPrivates {
  handleMidiIn(e: { data: Uint8Array }): void
  // Keyed by `${channel}:${note}` (§3), so the same note on two MPE channels is
  // two independent voices.
  midiInVoices: Map<string, { vId: number; channel: number; note: number; keyDown: boolean }>
  voices: Map<number, { baseMidi: number; expr: TouchExpression }>
  sustainOn: boolean
  // MIDI-out injection points.
  midiAccess: unknown
  midiReadyFlag: boolean
  noteOnAt(indexInScale: number, octave: number, expr: TouchExpression): number
}

const priv = instrumentStore as unknown as StoreMidiPrivates

const DEFAULT_EXPR: TouchExpression = { pitch: 0, glide: 0, timbre: 0.5, pressure: 0.8 }

/** Install a fake MIDI output that records every `send(bytes)`. */
function captureMidiOut(): number[][] {
  const sent: number[][] = []
  const output = { send: (m: number[]) => sent.push([...m]) }
  priv.midiAccess = { outputs: new Map([['out', output]]) }
  priv.midiReadyFlag = true
  return sent
}

const isNoteOn = (m: number[]): boolean => (m[0] & 0xf0) === 0x90
const isBend = (m: number[]): boolean => (m[0] & 0xf0) === 0xe0
const chan = (m: number[]): number => m[0] & 0x0f
const bendValue = (m: number[]): number => (m[1] | (m[2] << 7)) - 8192

function send(...bytes: number[]): void {
  priv.handleMidiIn({ data: new Uint8Array(bytes) })
}

function noteOn(channel: number, note: number, velocity = 100): void {
  send(0x90 | channel, note, velocity)
}

/** Pitch bend from a normalised -1..+1 value (14-bit, centre 8192). */
function bend(channel: number, value: number): void {
  const raw = Math.round(8192 + value * (value >= 0 ? 8191 : 8192))
  send(0xe0 | channel, raw & 0x7f, (raw >> 7) & 0x7f)
}

function noteOff(channel: number, note: number, velocity = 0): void {
  send(0x80 | channel, note, velocity)
}

/** Sustain pedal CC64: value >= 64 is "down". */
function sustain(channel: number, down: boolean): void {
  send(0xb0 | channel, 64, down ? 127 : 0)
}

function voiceFor(channel: number, note: number): { baseMidi: number; expr: TouchExpression } {
  const held = priv.midiInVoices.get(`${channel}:${note}`)
  expect(held).toBeDefined()
  const v = priv.voices.get(held!.vId)
  expect(v).toBeDefined()
  return v!
}

describe('MIDI-in pitch bend', () => {
  beforeEach(() => {
    instrumentStore.panic()
    instrumentStore.setMidiConfig({ inEnabled: true, outEnabled: false, outChannel: 1, mpe: false })
  })

  it('applies bend per channel so MPE voices stay independent', () => {
    noteOn(0, 60)
    noteOn(1, 64)
    const a = voiceFor(0, 60)
    const b = voiceFor(1, 64)

    bend(0, 1) // full up on channel 0 only: +2 semitones

    expect(voiceFor(0, 60).expr.pitch).toBeCloseTo(a.baseMidi + 2, 5)
    // The channel-1 voice must not inherit channel 0's bend.
    expect(voiceFor(1, 64).expr.pitch).toBeCloseTo(b.baseMidi, 5)
  })

  it('bends every voice on single-channel input exactly as before', () => {
    noteOn(0, 60)
    noteOn(0, 64)
    const a = voiceFor(0, 60)
    const b = voiceFor(0, 64)

    bend(0, 0.5) // half up: +1 semitone, ±2 semitone range

    expect(voiceFor(0, 60).expr.pitch).toBeCloseTo(a.baseMidi + 1, 3)
    expect(voiceFor(0, 64).expr.pitch).toBeCloseTo(b.baseMidi + 1, 3)

    bend(0, 0) // back to centre restores the base pitch
    expect(voiceFor(0, 60).expr.pitch).toBeCloseTo(a.baseMidi, 5)
    expect(voiceFor(0, 64).expr.pitch).toBeCloseTo(b.baseMidi, 5)
  })
})

describe('MIDI-in ownership by (channel, note) (§3)', () => {
  beforeEach(() => {
    instrumentStore.panic()
    instrumentStore.setMidiConfig({ inEnabled: true, outEnabled: false, outChannel: 1, mpe: false })
  })

  it('the same note on two MPE channels makes two independent voices', () => {
    noteOn(1, 60)
    noteOn(2, 60)
    expect(priv.midiInVoices.size).toBe(2)
    const a = voiceFor(1, 60)
    const b = voiceFor(2, 60)
    expect(a).not.toBe(b)
    expect(priv.voices.size).toBe(2)
  })

  it('a note-off releases only the matching channel voice', () => {
    noteOn(1, 60)
    noteOn(2, 60)
    noteOff(1, 60)
    expect(priv.midiInVoices.has('1:60')).toBe(false)
    // The channel-2 voice on the same note must remain sounding.
    expect(priv.midiInVoices.has('2:60')).toBe(true)
    expect(priv.voices.size).toBe(1)
  })

  it('a repeated note-on replaces only the same channel/note voice', () => {
    noteOn(1, 60)
    const firstId = priv.midiInVoices.get('1:60')!.vId
    noteOn(2, 60) // different channel — untouched
    noteOn(1, 60) // re-strike same channel/note — retrigger (new voice id)
    const secondId = priv.midiInVoices.get('1:60')!.vId
    expect(secondId).not.toBe(firstId)
    expect(priv.midiInVoices.has('2:60')).toBe(true)
    expect(priv.voices.size).toBe(2)
  })

  it('a bend on one channel never leaks to the same note on another channel', () => {
    noteOn(1, 60)
    noteOn(2, 60)
    const a = voiceFor(1, 60)
    const b = voiceFor(2, 60)
    bend(1, 1) // +2 semitones on channel 1 only
    expect(voiceFor(1, 60).expr.pitch).toBeCloseTo(a.baseMidi + 2, 5)
    expect(voiceFor(2, 60).expr.pitch).toBeCloseTo(b.baseMidi, 5)
  })
})

describe('MIDI sustain vs performance latch (§4)', () => {
  beforeEach(() => {
    instrumentStore.panic()
    instrumentStore.setLatch(false)
    instrumentStore.setMidiConfig({ inEnabled: true, outEnabled: false, outChannel: 1, mpe: false })
  })

  it('does not toggle the user-facing latch control', () => {
    sustain(0, true)
    expect(instrumentStore.getSnapshot().latch).toBe(false)
    expect(priv.sustainOn).toBe(true)
    sustain(0, false)
    expect(instrumentStore.getSnapshot().latch).toBe(false)
  })

  it('defers a note-off while the pedal is down, then releases on pedal up', () => {
    noteOn(0, 60)
    sustain(0, true)
    noteOff(0, 60) // key released, pedal down → note keeps sounding
    expect(priv.voices.size).toBe(1)
    expect(priv.midiInVoices.get('0:60')!.keyDown).toBe(false)
    sustain(0, false) // pedal up → the released key's note now stops
    expect(priv.voices.size).toBe(0)
    expect(priv.midiInVoices.size).toBe(0)
  })

  it('keeps notes whose key is still physically held when the pedal lifts', () => {
    noteOn(0, 60)
    noteOn(0, 64)
    sustain(0, true)
    noteOff(0, 60) // only 60's key released
    sustain(0, false)
    expect(priv.midiInVoices.has('0:60')).toBe(false) // released
    expect(priv.midiInVoices.has('0:64')).toBe(true) // still held
    expect(priv.voices.size).toBe(1)
  })

  it('retriggers (does not silence) when a sustained note is re-struck', () => {
    noteOn(0, 60)
    const firstId = priv.midiInVoices.get('0:60')!.vId
    sustain(0, true)
    noteOff(0, 60) // deferred — still sounding
    noteOn(0, 60) // re-strike: must retrigger, not toggle-off
    const held = priv.midiInVoices.get('0:60')
    expect(held).toBeDefined()
    expect(held!.vId).not.toBe(firstId)
    expect(held!.keyDown).toBe(true)
    expect(priv.voices.size).toBe(1)
  })

  it('panic clears sustain state', () => {
    noteOn(0, 60)
    sustain(0, true)
    noteOff(0, 60)
    instrumentStore.panic()
    expect(priv.sustainOn).toBe(false)
    expect(priv.midiInVoices.size).toBe(0)
    expect(priv.voices.size).toBe(0)
  })
})

describe('MIDI-out MPE (microtonal)', () => {
  beforeEach(() => {
    instrumentStore.panic()
    captureMidiOut()
    instrumentStore.setTuning(null)
  })

  it('sends each voice on its own member channel with a pitch bend', () => {
    instrumentStore.setTuning(JUST)
    instrumentStore.setMidiConfig({ inEnabled: false, outEnabled: true, outChannel: 1, mpe: true })
    const sent = captureMidiOut()

    // Sound two different scale degrees at once.
    priv.noteOnAt(2, 4, DEFAULT_EXPR)
    priv.noteOnAt(4, 4, DEFAULT_EXPR)

    const noteOns = sent.filter(isNoteOn)
    const bends = sent.filter(isBend)
    expect(noteOns).toHaveLength(2)
    expect(bends.length).toBeGreaterThanOrEqual(2)

    // Member channels (1..15), and the two voices differ.
    const channels = noteOns.map(chan)
    expect(channels.every((c) => c >= 1)).toBe(true)
    expect(new Set(channels).size).toBe(2)

    // Each note-on's channel carries a bend, and at least one is off-centre
    // (a just-intonation degree is not a 12-TET pitch).
    for (const on of noteOns) {
      expect(bends.some((b) => chan(b) === chan(on))).toBe(true)
    }
    expect(bends.some((b) => Math.abs(bendValue(b)) > 0)).toBe(true)
  })

  it('resets the bend to centre when an MPE voice is released (§21)', () => {
    instrumentStore.setTuning(JUST)
    instrumentStore.setMidiConfig({ inEnabled: false, outEnabled: true, outChannel: 1, mpe: true })
    const sent = captureMidiOut()
    const vId = priv.noteOnAt(2, 4, DEFAULT_EXPR) // a tuned degree → off-centre bend
    const onChannel = chan(sent.filter(isNoteOn)[0])
    sent.length = 0
    instrumentStore.noteOffVoice(vId)
    // The release must carry a centre bend (value 0) on that member channel.
    const centreBends = sent.filter((m) => isBend(m) && chan(m) === onChannel && bendValue(m) === 0)
    expect(centreBends.length).toBeGreaterThanOrEqual(1)
  })

  it('steals a channel with a correct note-off past 15 voices, no hung notes (§21)', () => {
    instrumentStore.setTuning(JUST)
    instrumentStore.setMidiConfig({ inEnabled: false, outEnabled: true, outChannel: 1, mpe: true })
    const sent = captureMidiOut()
    // 16 simultaneous voices — one more than the 15 MPE member channels.
    for (let i = 0; i < 16; i++) priv.noteOnAt(i % 7, 4, DEFAULT_EXPR)
    const noteOns = sent.filter(isNoteOn).length
    const noteOffs = sent.filter((m) => (m[0] & 0xf0) === 0x80).length
    expect(noteOns).toBe(16)
    // The 16th note stole a channel, which must have flushed exactly one voice.
    expect(noteOffs).toBe(1)
  })

  it('panic sends note-offs and neutralises bends across MPE channels (§21)', () => {
    instrumentStore.setTuning(JUST)
    instrumentStore.setMidiConfig({ inEnabled: false, outEnabled: true, outChannel: 1, mpe: true })
    priv.noteOnAt(2, 4, DEFAULT_EXPR)
    priv.noteOnAt(4, 4, DEFAULT_EXPR)
    const sent = captureMidiOut()
    instrumentStore.panic()
    expect(sent.filter((m) => (m[0] & 0xf0) === 0x80).length).toBeGreaterThanOrEqual(2)
    expect(sent.some((m) => isBend(m) && bendValue(m) === 0)).toBe(true)
  })

  it('stays single-channel with no pitch bend when MPE is off', () => {
    instrumentStore.setTuning(JUST)
    instrumentStore.setMidiConfig({ inEnabled: false, outEnabled: true, outChannel: 3, mpe: false })
    const sent = captureMidiOut()

    priv.noteOnAt(2, 4, DEFAULT_EXPR)

    const noteOns = sent.filter(isNoteOn)
    expect(noteOns).toHaveLength(1)
    expect(chan(noteOns[0])).toBe(2) // outChannel 3 → 0-indexed 2
    expect(sent.some(isBend)).toBe(false)
  })
})
