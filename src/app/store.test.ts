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
  midiInVoices: Map<number, { vId: number; channel: number }>
  voices: Map<number, { baseMidi: number; expr: TouchExpression }>
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

function voiceFor(note: number): { baseMidi: number; expr: TouchExpression } {
  const held = priv.midiInVoices.get(note)
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
    const a = voiceFor(60)
    const b = voiceFor(64)

    bend(0, 1) // full up on channel 0 only: +2 semitones

    expect(voiceFor(60).expr.pitch).toBeCloseTo(a.baseMidi + 2, 5)
    // The channel-1 voice must not inherit channel 0's bend.
    expect(voiceFor(64).expr.pitch).toBeCloseTo(b.baseMidi, 5)
  })

  it('bends every voice on single-channel input exactly as before', () => {
    noteOn(0, 60)
    noteOn(0, 64)
    const a = voiceFor(60)
    const b = voiceFor(64)

    bend(0, 0.5) // half up: +1 semitone, ±2 semitone range

    expect(voiceFor(60).expr.pitch).toBeCloseTo(a.baseMidi + 1, 3)
    expect(voiceFor(64).expr.pitch).toBeCloseTo(b.baseMidi + 1, 3)

    bend(0, 0) // back to centre restores the base pitch
    expect(voiceFor(60).expr.pitch).toBeCloseTo(a.baseMidi, 5)
    expect(voiceFor(64).expr.pitch).toBeCloseTo(b.baseMidi, 5)
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
