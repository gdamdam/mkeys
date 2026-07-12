import { beforeEach, describe, expect, it } from 'vitest'
import type { TouchExpression } from '../types'
import { instrumentStore } from './store'

/**
 * Structural view of the store's private MIDI-in internals so tests can feed
 * raw messages and inspect voice expression without widening the public API.
 */
interface StoreMidiPrivates {
  handleMidiIn(e: { data: Uint8Array }): void
  midiInVoices: Map<number, { vId: number; channel: number }>
  voices: Map<number, { baseMidi: number; expr: TouchExpression }>
}

const priv = instrumentStore as unknown as StoreMidiPrivates

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
    instrumentStore.setMidiConfig({ inEnabled: true, outEnabled: false, outChannel: 1 })
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
