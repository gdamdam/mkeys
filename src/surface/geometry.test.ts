import { describe, expect, it } from 'vitest'
import type { SurfaceConfig } from '../types'
import {
  buildGrid,
  cellAt,
  makeDegreeToMidi,
  pianoPointerToDegree,
  placementMidi,
  pointerToCell,
  slideTargetCell,
  toPlacement,
  yToTimbre,
} from './geometry'

/** A 7-note diatonic scale length used across tests. */
const SCALE_LEN = 7

function gridConfig(overrides: Partial<SurfaceConfig> = {}): SurfaceConfig {
  return {
    layout: 'grid',
    rows: 4,
    cols: 8,
    rowOffsetDegrees: 3,
    quantize: 1,
    baseOctave: 4,
    ...overrides,
  }
}

function pianoConfig(overrides: Partial<SurfaceConfig> = {}): SurfaceConfig {
  return {
    layout: 'piano',
    rows: 1,
    cols: 8,
    rowOffsetDegrees: 0,
    quantize: 1,
    baseOctave: 4,
    ...overrides,
  }
}

describe('cellAt (isomorphic layout)', () => {
  it('origin cell is degree 0 at baseOctave', () => {
    expect(cellAt(0, 0, gridConfig(), SCALE_LEN)).toEqual({ degree: 0, octave: 4 })
  })

  it('each column steps one scale degree', () => {
    const c = gridConfig()
    expect(cellAt(0, 1, c, SCALE_LEN)).toEqual({ degree: 1, octave: 4 })
    expect(cellAt(0, 6, c, SCALE_LEN)).toEqual({ degree: 6, octave: 4 })
  })

  it('column wraps to next octave after a full scale', () => {
    // col 7 with a 7-note scale = one octave above degree 0
    expect(cellAt(0, 7, gridConfig(), SCALE_LEN)).toEqual({ degree: 0, octave: 5 })
  })

  it('row + 1 shifts degree by rowOffsetDegrees', () => {
    const c = gridConfig({ rowOffsetDegrees: 3 })
    // row 1 col 0 => absolute degree 3
    expect(cellAt(1, 0, c, SCALE_LEN)).toEqual({ degree: 3, octave: 4 })
    // row 2 col 0 => absolute degree 6
    expect(cellAt(2, 0, c, SCALE_LEN)).toEqual({ degree: 6, octave: 4 })
    // row 3 col 0 => absolute degree 9 => degree 2, octave 5
    expect(cellAt(3, 0, c, SCALE_LEN)).toEqual({ degree: 2, octave: 5 })
  })

  it('respects a different rowOffsetDegrees', () => {
    const c = gridConfig({ rowOffsetDegrees: 2 })
    expect(cellAt(1, 0, c, SCALE_LEN)).toEqual({ degree: 2, octave: 4 })
    expect(cellAt(1, 5, c, SCALE_LEN)).toEqual({ degree: 0, octave: 5 })
  })

  it('honours baseOctave', () => {
    expect(cellAt(0, 0, gridConfig({ baseOctave: 2 }), SCALE_LEN)).toEqual({
      degree: 0,
      octave: 2,
    })
  })

  it('handles pentatonic (5-note) scale length', () => {
    const c = gridConfig()
    expect(cellAt(0, 5, c, 5)).toEqual({ degree: 0, octave: 5 })
    expect(cellAt(0, 7, c, 5)).toEqual({ degree: 2, octave: 5 })
  })
})

describe('buildGrid', () => {
  it('produces a rows x cols matrix with coordinates', () => {
    const c = gridConfig({ rows: 3, cols: 4 })
    const grid = buildGrid(c, SCALE_LEN)
    expect(grid).toHaveLength(3)
    expect(grid[0]).toHaveLength(4)
    expect(grid[1][2]).toMatchObject({ row: 1, col: 2 })
  })

  it('cells match cellAt', () => {
    const c = gridConfig({ rows: 4, cols: 8 })
    const grid = buildGrid(c, SCALE_LEN)
    for (let r = 0; r < c.rows; r++) {
      for (let col = 0; col < c.cols; col++) {
        const expected = cellAt(r, col, c, SCALE_LEN)
        expect(grid[r][col]).toMatchObject(expected)
      }
    }
  })
})

describe('makeDegreeToMidi / placementMidi / toPlacement', () => {
  // C major pitch classes (root 0)
  const cMajor = [0, 2, 4, 5, 7, 9, 11]

  it('maps degree 0 octave 4 to middle C (60)', () => {
    const f = makeDegreeToMidi(cMajor, 0)
    expect(f(0, 4)).toBe(60)
  })

  it('maps the perfect fifth correctly', () => {
    const f = makeDegreeToMidi(cMajor, 0)
    expect(f(4, 4)).toBe(67) // G4
  })

  it('octaves are 12 semitones apart', () => {
    const f = makeDegreeToMidi(cMajor, 0)
    expect(f(0, 5) - f(0, 4)).toBe(12)
  })

  it('handles a wrapping key (F major) without octave errors', () => {
    const fMajor = [5, 7, 9, 10, 0, 2, 4]
    const f = makeDegreeToMidi(fMajor, 5)
    expect(f(0, 4)).toBe(65) // F4
    expect(f(4, 4)).toBe(72) // C5 (the fifth of F)
    expect(f(6, 4)).toBe(76) // E5 (major 7th)
  })

  it('placementMidi maps a cell through the callback', () => {
    const f = makeDegreeToMidi(cMajor, 0)
    expect(placementMidi({ degree: 0, octave: 4 }, f)).toBe(60)
  })

  it('toPlacement produces a full ScalePlacement', () => {
    const f = makeDegreeToMidi(cMajor, 0)
    expect(toPlacement({ degree: 4, octave: 4 }, f)).toEqual({
      degree: 4,
      octave: 4,
      midi: 67,
    })
  })

  it('round-trips a built grid to MIDI monotonically along a row', () => {
    const c = gridConfig()
    const f = makeDegreeToMidi(cMajor, 0)
    const grid = buildGrid(c, SCALE_LEN)
    const rowMidi = grid[0].map((cell) => placementMidi(cell, f))
    for (let i = 1; i < rowMidi.length; i++) {
      expect(rowMidi[i]).toBeGreaterThan(rowMidi[i - 1])
    }
  })
})

describe('pointerToCell (grid)', () => {
  it('top-left region maps to the top row, first column', () => {
    const c = gridConfig({ rows: 4, cols: 8 })
    // y near 0 = top of surface = highest row index
    expect(pointerToCell(0.01, 0.01, c)).toEqual({ row: 3, col: 0 })
  })

  it('bottom-left maps to row 0', () => {
    const c = gridConfig({ rows: 4, cols: 8 })
    expect(pointerToCell(0.01, 0.99, c)).toEqual({ row: 0, col: 0 })
  })

  it('detects column boundaries at cell edges', () => {
    const c = gridConfig({ rows: 1, cols: 4 })
    // 4 columns => edges at 0.25, 0.5, 0.75
    expect(pointerToCell(0.24, 0.5, c)?.col).toBe(0)
    expect(pointerToCell(0.26, 0.5, c)?.col).toBe(1)
    expect(pointerToCell(0.49, 0.5, c)?.col).toBe(1)
    expect(pointerToCell(0.51, 0.5, c)?.col).toBe(2)
    expect(pointerToCell(0.99, 0.5, c)?.col).toBe(3)
  })

  it('clamps exact right/top edges into range', () => {
    const c = gridConfig({ rows: 4, cols: 8 })
    expect(pointerToCell(1, 0, c)).toEqual({ row: 3, col: 7 })
    expect(pointerToCell(0, 1, c)).toEqual({ row: 0, col: 0 })
  })

  it('returns null when out of the 0..1 range', () => {
    const c = gridConfig()
    expect(pointerToCell(-0.01, 0.5, c)).toBeNull()
    expect(pointerToCell(0.5, 1.01, c)).toBeNull()
    expect(pointerToCell(1.5, 0.5, c)).toBeNull()
  })
})

describe('pianoPointerToDegree (strip)', () => {
  it('maps left edge to degree 0 at baseOctave', () => {
    const c = pianoConfig({ cols: 8 })
    expect(pianoPointerToDegree(0.01, c, SCALE_LEN)).toEqual({ degree: 0, octave: 4 })
  })

  it('walks degrees across the strip and wraps octave', () => {
    const c = pianoConfig({ cols: 8 })
    expect(pianoPointerToDegree(0.2, c, SCALE_LEN)?.degree).toBe(1)
    // index 7 of 8 => degree 0 octave 5
    expect(pianoPointerToDegree(0.95, c, SCALE_LEN)).toEqual({ degree: 0, octave: 5 })
  })

  it('clamps the exact right edge', () => {
    const c = pianoConfig({ cols: 8 })
    expect(pianoPointerToDegree(1, c, SCALE_LEN)).toEqual({ degree: 0, octave: 5 })
  })

  it('returns null out of range', () => {
    const c = pianoConfig()
    expect(pianoPointerToDegree(-0.1, c, SCALE_LEN)).toBeNull()
    expect(pianoPointerToDegree(1.2, c, SCALE_LEN)).toBeNull()
  })
})

describe('yToTimbre', () => {
  it('top (y=0) is fully bright', () => {
    expect(yToTimbre(0)).toBe(1)
  })

  it('bottom (y=1) is fully dark', () => {
    expect(yToTimbre(1)).toBe(0)
  })

  it('midpoint is 0.5', () => {
    expect(yToTimbre(0.5)).toBeCloseTo(0.5)
  })

  it('clamps values outside 0..1', () => {
    expect(yToTimbre(-0.5)).toBe(1)
    expect(yToTimbre(2)).toBe(0)
  })
})

describe('slideTargetCell', () => {
  it('slides right to the adjacent (higher) degree', () => {
    const c = gridConfig({ rows: 4, cols: 8 })
    expect(slideTargetCell({ row: 1, col: 2 }, 1, c)).toEqual({ row: 1, col: 3 })
  })

  it('slides left to the adjacent (lower) degree', () => {
    const c = gridConfig({ rows: 4, cols: 8 })
    expect(slideTargetCell({ row: 1, col: 2 }, -1, c)).toEqual({ row: 1, col: 1 })
  })

  it('normalises any nonzero direction to a single step', () => {
    const c = gridConfig({ rows: 4, cols: 8 })
    expect(slideTargetCell({ row: 0, col: 0 }, 5, c)).toEqual({ row: 0, col: 1 })
  })

  it('returns null past the right edge', () => {
    const c = gridConfig({ rows: 4, cols: 8 })
    expect(slideTargetCell({ row: 0, col: 7 }, 1, c)).toBeNull()
  })

  it('returns null past the left edge', () => {
    const c = gridConfig({ rows: 4, cols: 8 })
    expect(slideTargetCell({ row: 0, col: 0 }, -1, c)).toBeNull()
  })

  it('returns null for a zero direction (no adjacent target)', () => {
    const c = gridConfig({ rows: 4, cols: 8 })
    expect(slideTargetCell({ row: 0, col: 3 }, 0, c)).toBeNull()
  })
})
