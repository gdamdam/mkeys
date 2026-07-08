/**
 * Tuning survives the share-URL round-trip, and an invalid tuning is rejected
 * on read (the codec is a trust boundary — a malformed `tuning` must never reach
 * the engine, it falls back to 12-TET).
 */
import { describe, expect, it } from 'vitest'
import { decodeSession, encodeSession, sessionFromUrl, sessionToShareUrl } from './codec'
import { createDefaultSession } from './codec'
import type { PortableTuning } from '../types'

const NINETEEN_EDO: PortableTuning = {
  tonicHz: 261.6255653005986,
  scaleCents: Array.from({ length: 19 }, (_, i) => (i * 1200) / 19),
  period: 1200,
  name: '19-EDO',
}

describe('tuning share codec', () => {
  it('round-trips a 19-note non-standard tuning through the share URL', () => {
    const session = { ...createDefaultSession(), tuning: NINETEEN_EDO }
    const url = sessionToShareUrl(session)
    const back = sessionFromUrl(url)
    expect(back).not.toBeNull()
    expect(back!.tuning).toBeDefined()
    expect(back!.tuning!.name).toBe('19-EDO')
    expect(back!.tuning!.scaleCents).toHaveLength(19)
    expect(back!.tuning!.scaleCents[0]).toBe(0)
    expect(back!.tuning!.period).toBeCloseTo(1200, 6)
    expect(back!.tuning!.tonicHz).toBeCloseTo(NINETEEN_EDO.tonicHz, 6)
  })

  it('preserves a non-octave period', () => {
    const bp: PortableTuning = {
      tonicHz: 220,
      scaleCents: [0, 400, 900],
      period: 1200 * Math.log2(3),
      name: 'BP-ish',
    }
    const back = decodeSession(encodeSession({ ...createDefaultSession(), tuning: bp }))
    expect(back!.tuning!.period).toBeCloseTo(1200 * Math.log2(3), 4)
  })

  it('a session without a tuning decodes as 12-TET (tuning undefined)', () => {
    const back = decodeSession(encodeSession(createDefaultSession()))
    expect(back!.tuning).toBeUndefined()
  })

  it('rejects an invalid tuning on read (non-ascending / bad tonic → dropped)', () => {
    const bad = { ...createDefaultSession(), tuning: { tonicHz: -1, scaleCents: [0, 5, 5], name: 'x' } }
    const back = decodeSession(encodeSession(bad as never))
    expect(back!.tuning).toBeUndefined()
  })
})
