import { describe, expect, it } from 'vitest'
import {
  degreeOctaveToHz,
  freqToMidi,
  importSclText,
  isValidTuning,
  midiToTunedCell,
  refFreqFromKbmText,
  scaleLengthOf,
} from './tuning'
import type { PortableTuning } from './tuning'
import { BUILTIN_PORTABLE_TUNINGS } from '../vendor/tuning-core/builtins'
import { parseScl, sclToPortable } from '../vendor/tuning-core/scala'

/** midiToFreq mirror of the worklet's 12-TET formula (A4 = 69 = 440 Hz). */
const midiToFreq = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12)

/** An N-EDO tuning: N equal steps of 1200/N cents spanning one octave. */
function edo(n: number, tonicHz = 261.6255653005986): PortableTuning {
  const scaleCents = Array.from({ length: n }, (_, i) => (i * 1200) / n)
  return { tonicHz, scaleCents, period: 1200, name: `${n}-EDO` }
}

describe('degreeOctaveToHz', () => {
  it('(a) 12-TET tuning is regression-identical to midiToFreq at the reference octave', () => {
    // The builtin "Equal (12-TET)" tuning, played over the surface's reference
    // octave (4), must resolve every degree to exactly the frequency the worklet
    // would have computed for the corresponding MIDI note — degree 0 = C4 = 60.
    const tet = BUILTIN_PORTABLE_TUNINGS[0]
    expect(tet.name).toContain('12-TET')
    for (let d = 0; d < 24; d++) {
      const hz = degreeOctaveToHz(tet, d, 4)
      expect(hz).toBeCloseTo(midiToFreq(60 + d), 6)
    }
  })

  it('(b) a 19-EDO scale plays 19 distinct steps per octave, then repeats an octave up', () => {
    const t = edo(19)
    expect(scaleLengthOf(t)).toBe(19)
    const freqs = Array.from({ length: 19 }, (_, d) => degreeOctaveToHz(t, d, 4))
    // 19 genuinely distinct pitches inside one octave.
    expect(new Set(freqs.map((f) => f.toFixed(4))).size).toBe(19)
    // Each step is the same ratio 2^(1/19) above the previous.
    const step = Math.pow(2, 1 / 19)
    for (let d = 1; d < 19; d++) {
      expect(freqs[d] / freqs[d - 1]).toBeCloseTo(step, 9)
    }
    // Degree 19 wraps to degree 0 exactly one octave (2×) higher.
    expect(degreeOctaveToHz(t, 19, 4)).toBeCloseTo(freqs[0] * 2, 6)
    // Degree −1 is the top step of the octave below.
    expect(degreeOctaveToHz(t, -1, 4)).toBeCloseTo(freqs[18] / 2, 6)
  })

  it('(c) a Scala non-octave scale maps degrees correctly and repeats at its period', () => {
    // A minimal 3-note Bohlen-Pierce-style scale whose period is the tritave
    // (3/1 = 1901.955 cents), not the octave.
    const scl = parseScl(['! bp.scl', 'tiny non-octave', '3', '400.0', '900.0', '3/1'].join('\n'))
    expect(scl.period).toBeCloseTo(1200 * Math.log2(3), 3)
    const t = sclToPortable(scl, 220)
    expect(scaleLengthOf(t)).toBe(3) // [0, 400, 900] — the 3/1 period is not a degree
    const d0 = degreeOctaveToHz(t, 0, 4)
    expect(d0).toBeCloseTo(220, 6) // degree 0 at the reference octave is the tonic
    expect(degreeOctaveToHz(t, 1, 4)).toBeCloseTo(220 * Math.pow(2, 400 / 1200), 6)
    expect(degreeOctaveToHz(t, 2, 4)).toBeCloseTo(220 * Math.pow(2, 900 / 1200), 6)
    // One full period up (degree 3) is the tonic × 3 (the tritave), not × 2.
    expect(degreeOctaveToHz(t, 3, 4)).toBeCloseTo(220 * 3, 5)
  })
})

describe('importSclText', () => {
  it('parses a 19-EDO .scl into a valid 19-step tuning', () => {
    // Scala cents tokens must contain a '.', so format each with a decimal.
    const lines = ['! 19edo.scl', '19-EDO', '19']
    for (let i = 1; i <= 19; i++) lines.push(`${((i * 1200) / 19).toFixed(6)}`)
    const t = importSclText(lines.join('\n'), 261.6255653005986)
    expect(isValidTuning(t)).toBe(true)
    expect(scaleLengthOf(t)).toBe(19)
    expect(t.scaleCents[0]).toBe(0)
    expect(degreeOctaveToHz(t, 19, 4)).toBeCloseTo(degreeOctaveToHz(t, 0, 4) * 2, 6)
  })

  it('throws on a malformed .scl', () => {
    expect(() => importSclText('not a scale', 440)).toThrow()
  })
})

describe('refFreqFromKbmText', () => {
  it('reads the reference frequency from a .kbm', () => {
    // 7 header lines (size, first, last, middle, refNote, refFreq, formalOctave)
    // then `size` (12) mapping entries.
    const map = Array.from({ length: 12 }, (_, i) => String(i))
    const kbm = ['! map.kbm', '12', '0', '127', '60', '69', '432.0', '12', ...map].join('\n')
    expect(refFreqFromKbmText(kbm)).toBeCloseTo(432, 6)
  })
})

describe('freqToMidi', () => {
  it('inverts midiToFreq', () => {
    expect(freqToMidi(440)).toBeCloseTo(69, 9)
    expect(freqToMidi(midiToFreq(60))).toBeCloseTo(60, 9)
  })
})

describe('midiToTunedCell (§3-A MIDI-in mapping)', () => {
  it('anchors the tonic at MIDI 60 for a 12-note tuning (keyRoot C)', () => {
    const tet = edo(12)
    const cell = midiToTunedCell(60, 0, tet)
    expect(cell).toEqual({ index: 0, octave: 4 }) // C4 → degree 0, reference octave
  })

  it('reaches all 19 degrees of a 19-note tuning across MIDI 60‥78', () => {
    const t = edo(19)
    const cells = Array.from({ length: 19 }, (_, i) => midiToTunedCell(60 + i, 0, t)!)
    const indices = cells.map((c) => c.index)
    // 19 consecutive notes → 19 distinct degrees, all in the reference octave.
    expect(new Set(indices).size).toBe(19)
    expect(indices).toEqual(Array.from({ length: 19 }, (_, i) => i))
    expect(cells.every((c) => c.octave === 4)).toBe(true)
    // The 20th note rolls into the next octave register at degree 0.
    expect(midiToTunedCell(79, 0, t)).toEqual({ index: 0, octave: 5 })
  })

  it('honors a .kbm keyboard map when present', () => {
    const t = edo(12)
    // A whole-tone keyboard map: 6 keys per period hitting even degrees,
    // refNote 60 → degree 0. Key 60→0, 61→2, 62→4, 63→6, 64→8, 65→10, 66→0(+1oct).
    const kbm = { refNote: 60, degrees: [0, 2, 4, 6, 8, 10] }
    expect(midiToTunedCell(60, 0, t, kbm)).toEqual({ index: 0, octave: 4 })
    expect(midiToTunedCell(62, 0, t, kbm)).toEqual({ index: 4, octave: 4 })
    expect(midiToTunedCell(65, 0, t, kbm)).toEqual({ index: 10, octave: 4 })
    expect(midiToTunedCell(66, 0, t, kbm)).toEqual({ index: 0, octave: 5 })
    // The map overrides the linear default: note 61 → degree 2, not degree 1.
    expect(midiToTunedCell(61, 0, t, kbm)!.index).toBe(2)
  })

  it('returns null for a key a .kbm leaves unmapped', () => {
    const t = edo(12)
    const kbm = { refNote: 60, degrees: [0, -1, 2, -1, 4, -1] }
    expect(midiToTunedCell(61, 0, t, kbm)).toBeNull()
    expect(midiToTunedCell(60, 0, t, kbm)).toEqual({ index: 0, octave: 4 })
  })
})
