/**
 * Envelope timing tests.
 *
 * The release stage is exponential (natural analog-style tail) but its time
 * constant is retuned so the *audible* release length matches the dial: a
 * release of R seconds should fade a held note to inaudible in ~R seconds,
 * consistent with the linear attack/decay stages. Before this retuning the
 * release used R directly as the time constant, so the real tail ran ~9× long.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { Envelope as EnvelopeType } from './synth.worklet'

let Envelope: new () => EnvelopeType

beforeAll(async () => {
  ;(globalThis as Record<string, unknown>).sampleRate = 48000
  ;(globalThis as Record<string, unknown>).currentTime = 0
  ;(globalThis as Record<string, unknown>).registerProcessor = () => {}
  ;(globalThis as Record<string, unknown>).AudioWorkletProcessor = class {
    port = { onmessage: null }
  }
  ;({ Envelope } = await import('./synth.worklet'))
})

const SR = 48000
const DT = 1 / SR

/** Advance `env` until it leaves the given stage set, capped at `maxSeconds`. */
function stepUntilIdle(env: EnvelopeType, maxSeconds: number): number {
  const maxSteps = Math.ceil(maxSeconds / DT)
  let steps = 0
  while (!env.isIdle() && steps < maxSteps) {
    env.process(DT)
    steps++
  }
  return steps * DT
}

describe('Envelope release timing', () => {
  // Measured release should land near the dial across the useful range.
  for (const release of [0.05, 0.3, 1.0]) {
    it(`fades to idle in ~${release}s after gate-off (release=${release})`, () => {
      const env = new Envelope()
      env.set(0.001, 0.001, 0.6, release)
      env.gateOn()
      // Reach the sustain plateau before releasing.
      for (let t = 0; t < 0.05; t += DT) env.process(DT)
      env.gateOff()
      const elapsed = stepUntilIdle(env, release * 4 + 0.1)
      // Exponential tail: allow generous tolerance but reject the ~9× overshoot
      // the un-retuned (time-constant == dial) release produced.
      expect(elapsed).toBeGreaterThan(release * 0.6)
      expect(elapsed).toBeLessThan(release * 1.6)
    })
  }

  it('release of 0 snaps to idle immediately', () => {
    const env = new Envelope()
    env.set(0.001, 0.001, 0.6, 0)
    env.gateOn()
    for (let t = 0; t < 0.05; t += DT) env.process(DT)
    env.gateOff()
    env.process(DT)
    expect(env.isIdle()).toBe(true)
  })
})
