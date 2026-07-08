import { describe, expect, it } from 'vitest'
import { estimateRoundTripMs } from './engine'

// Round-trip latency readout. The AudioContext exposes baseLatency +
// outputLatency in *seconds*; the helper reports their sum in ms. Either field
// can be absent (Safari has no outputLatency; older engines have neither), so
// it must degrade to the sum of whatever is present rather than read NaN.
describe('estimateRoundTripMs', () => {
  it('sums baseLatency + outputLatency (in ms) when both are present', () => {
    expect(estimateRoundTripMs({ baseLatency: 0.005, outputLatency: 0.01 })).toBeCloseTo(15)
  })

  it('falls back to baseLatency alone when outputLatency is absent', () => {
    expect(estimateRoundTripMs({ baseLatency: 0.008 })).toBeCloseTo(8)
  })

  it('falls back to outputLatency alone when baseLatency is absent', () => {
    expect(estimateRoundTripMs({ outputLatency: 0.012 })).toBeCloseTo(12)
  })

  it('is 0 when neither field is available', () => {
    expect(estimateRoundTripMs({})).toBe(0)
  })
})
