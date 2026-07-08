/**
 * Verifies retuning crosses the worklet message boundary: a note-on may carry a
 * resolved `freq` (Hz) that overrides the built-in 12-TET `midiToFreq(midi)`,
 * while a note-on WITHOUT `freq` stays exactly 12-TET (the regression contract).
 *
 * Pitch is measured from the rendered signal by counting zero crossings of a
 * clean sine voice, so it is robust to the random initial oscillator phase.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { PatchParams } from '../../types'

interface ProcessorLike {
  port: { onmessage: ((e: { data: unknown }) => void) | null }
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean
}

let ProcessorClass: new () => ProcessorLike
const SR = 48000

beforeAll(async () => {
  ;(globalThis as Record<string, unknown>).sampleRate = SR
  ;(globalThis as Record<string, unknown>).currentTime = 0
  ;(globalThis as Record<string, unknown>).registerProcessor = (
    _name: string,
    cls: new () => ProcessorLike,
  ) => {
    ProcessorClass = cls
  }
  ;(globalThis as Record<string, unknown>).AudioWorkletProcessor = class {
    port = { onmessage: null }
  }
  await import('./synth.worklet')
})

const BLOCK = 128

/** A clean single-sine patch so zero-crossing pitch detection is unambiguous. */
function sinePatch(): PatchParams {
  return {
    osc1: { wave: 'sine', detune: 0, level: 1, pulseWidth: 0.5, sync: false, fm: 0 },
    osc2: { wave: 'sine', detune: 0, level: 0, pulseWidth: 0.5, sync: false, fm: 0 },
    subLevel: 0,
    noiseLevel: 0,
    filter: { cutoff: 18000, resonance: 0, drive: 0, envAmount: 0, keytrack: 0 },
    ampEnv: { attack: 0.001, decay: 0.05, sustain: 1, release: 0.2 },
    filterEnv: { attack: 0.01, decay: 0.1, sustain: 1, release: 0.2 },
    lfo: { rate: 4, depth: 0, target: 'filter', tempoSync: false, division: 4 },
    unison: { voices: 1, detune: 0, spread: 0 },
    glide: { time: 0, mode: 'off' },
    volume: 1,
  }
}

/** Render `blocks` blocks and estimate the left-channel fundamental (Hz). */
function measureHz(proc: ProcessorLike, blocks: number): number {
  const samples: number[] = []
  for (let b = 0; b < blocks; b++) {
    const left = new Float32Array(BLOCK)
    const right = new Float32Array(BLOCK)
    proc.process([], [[left, right]])
    for (let i = 0; i < BLOCK; i++) samples.push(left[i])
  }
  // Skip the attack transient, then count upward zero crossings.
  const start = Math.floor(samples.length * 0.25)
  let crossings = 0
  for (let i = start + 1; i < samples.length; i++) {
    if (samples[i - 1] <= 0 && samples[i] > 0) crossings++
  }
  const durationSec = (samples.length - start) / SR
  return crossings / durationSec
}

function makeProc(): { proc: ProcessorLike; send: (m: unknown) => void } {
  const proc = new ProcessorClass()
  const send = (msg: unknown): void => proc.port.onmessage?.({ data: msg })
  send({ type: 'setPatch', patch: sinePatch() })
  return { proc, send }
}

describe('synth worklet retuning boundary', () => {
  it('plays midiToFreq(midi) when no freq is supplied (12-TET regression)', () => {
    const { proc, send } = makeProc()
    send({ type: 'noteOn', id: 1, midi: 69, velocity: 1 }) // A4 = 440 Hz
    expect(measureHz(proc, 400)).toBeCloseTo(440, -0.5)
  })

  it('plays the supplied freq, overriding the midi field', () => {
    const { proc, send } = makeProc()
    // midi says 60 (C4 ≈ 261.6 Hz) but freq forces 440 Hz — freq must win.
    send({ type: 'noteOn', id: 2, midi: 60, velocity: 1, freq: 440 })
    const hz = measureHz(proc, 400)
    expect(hz).toBeCloseTo(440, -0.5)
    expect(hz).toBeGreaterThan(400) // not the 261.6 Hz that midi:60 alone would give
  })

  it('bends expression relative to the note-on freq (semitone-accurate on a tuned note)', () => {
    const { proc, send } = makeProc()
    // Tuned note-on at 300 Hz; then an expression a MIDI whole-tone above the
    // note-on midi must raise pitch by 2 semitones RELATIVE to 300 Hz.
    send({ type: 'noteOn', id: 3, midi: 60, velocity: 1, freq: 300 })
    send({ type: 'expression', id: 3, expr: { pitch: 62, glide: 0, timbre: 0, pressure: 1 } })
    expect(measureHz(proc, 400)).toBeCloseTo(300 * Math.pow(2, 2 / 12), -0.6)
  })
})
