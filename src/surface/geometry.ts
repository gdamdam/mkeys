/**
 * Scale-locked playing-surface geometry.
 *
 * Pure hit/slide math for the isomorphic grid and piano-strip surfaces. This
 * module is intentionally independent of the harmony/scales module: it never
 * imports scale definitions. Scale data is injected as parameters — either the
 * scale length (for degree/octave arithmetic) or a `DegreeToMidi` callback
 * (for pitch resolution) — so the geometry stays testable in a `node`
 * environment with no DOM/AudioContext.
 */
import type { ScalePlacement, SurfaceConfig } from '../types'

/** A cell addressed purely by scale position. */
export interface DegreeOctave {
  /** 0-based scale degree within the injected scale (0 = tonic). */
  degree: number
  octave: number
}

/** A cell addressed by its grid coordinates. */
export interface CellRef {
  row: number
  col: number
}

/** A fully resolved grid cell: coordinates plus scale position. */
export interface GridCell extends CellRef, DegreeOctave {}

/**
 * Resolves a scale position to a (possibly fractional-free) MIDI note number.
 * Injected by the caller (typically built from the active key/mode) so this
 * module never depends on harmony internals.
 */
export type DegreeToMidi = (degree: number, octave: number) => number

/** Clamp a float index into `[0, count - 1]` (guards exact right/top edges). */
function clampIndex(idx: number, count: number): number {
  if (idx < 0) return 0
  if (idx > count - 1) return count - 1
  return idx
}

/** Positive-remainder modulo (JS `%` keeps the sign of the dividend). */
function floorMod(n: number, m: number): number {
  return ((n % m) + m) % m
}

/**
 * Isomorphic mapping from grid coordinates to a scale position.
 *
 * Each column advances one scale degree; each row is offset by
 * `config.rowOffsetDegrees` degrees. A full `scaleLength` of degrees advances
 * one octave. Pure arithmetic — valid for any integer coordinates (callers
 * clamp/bound via the pointer helpers).
 */
export function cellAt(
  row: number,
  col: number,
  config: SurfaceConfig,
  scaleLength: number,
): DegreeOctave {
  const absoluteDegree = row * config.rowOffsetDegrees + col
  const degree = floorMod(absoluteDegree, scaleLength)
  const octave = config.baseOctave + Math.floor(absoluteDegree / scaleLength)
  return { degree, octave }
}

/**
 * The grid-building config a layout actually uses. The piano strip is a single
 * row of consecutive degrees (row 0 of the isomorphic mapping); the grid keeps
 * its full `rows x cols`. Every consumer of a surface's geometry (grid builder,
 * renderer, pointer hit-testing) must go through this so they stay consistent.
 */
export function effectiveSurface(config: SurfaceConfig): SurfaceConfig {
  return config.layout === 'piano' ? { ...config, rows: 1 } : config
}

/** Build the full `rows x col` grid, indexed `[row][col]`. */
export function buildGrid(config: SurfaceConfig, scaleLength: number): GridCell[][] {
  const grid: GridCell[][] = []
  for (let row = 0; row < config.rows; row++) {
    const rowCells: GridCell[] = []
    for (let col = 0; col < config.cols; col++) {
      const { degree, octave } = cellAt(row, col, config, scaleLength)
      rowCells.push({ row, col, degree, octave })
    }
    grid.push(rowCells)
  }
  return grid
}

/**
 * Build a `DegreeToMidi` from injected scale data.
 *
 * `scalePitchClasses` are the scale's pitch classes rooted at `root` (as
 * produced by the harmony module, e.g. C major -> [0,2,4,5,7,9,11]). The
 * per-degree semitone offset is derived from the pitch classes relative to
 * `root`, so wrapping keys (e.g. F major, where the fifth's pitch class is
 * numerically below the tonic's) still resolve to the correct octave.
 */
export function makeDegreeToMidi(
  scalePitchClasses: number[],
  root: number,
): DegreeToMidi {
  return (degree, octave) => {
    const pc = scalePitchClasses[floorMod(degree, scalePitchClasses.length)]
    const semitoneOffset = floorMod(pc - root, 12)
    // MIDI convention: octave 4 (C4) = 60, i.e. 12 * (octave + 1) for C.
    return 12 * (octave + 1) + root + semitoneOffset
  }
}

/** Resolve a cell's MIDI note through an injected mapping. */
export function placementMidi(cell: DegreeOctave, degreeToMidi: DegreeToMidi): number {
  return degreeToMidi(cell.degree, cell.octave)
}

/** Resolve a cell to a full {@link ScalePlacement}. */
export function toPlacement(
  cell: DegreeOctave,
  degreeToMidi: DegreeToMidi,
): ScalePlacement {
  return {
    degree: cell.degree,
    octave: cell.octave,
    midi: degreeToMidi(cell.degree, cell.octave),
  }
}

/**
 * Map a normalized pointer position to a grid cell.
 *
 * `x`/`y` are in `0..1` with the origin at the top-left of the surface. The
 * vertical axis is inverted so the top of the surface (`y = 0`) is the highest
 * row index — higher on screen plays higher pitch. Exact right/top edges clamp
 * into range; anything outside `0..1` returns `null` (out of bounds).
 */
export function pointerToCell(
  x: number,
  y: number,
  config: SurfaceConfig,
): CellRef | null {
  if (x < 0 || x > 1 || y < 0 || y > 1) return null
  const col = clampIndex(Math.floor(x * config.cols), config.cols)
  const row = clampIndex(Math.floor((1 - y) * config.rows), config.rows)
  return { row, col }
}

/**
 * Piano-strip variant: map a normalized horizontal position to a scale
 * position across `config.cols` degrees. `x` outside `0..1` returns `null`.
 */
export function pianoPointerToDegree(
  x: number,
  config: SurfaceConfig,
  scaleLength: number,
): DegreeOctave | null {
  if (x < 0 || x > 1) return null
  const index = clampIndex(Math.floor(x * config.cols), config.cols)
  return cellAt(0, index, config, scaleLength)
}

/**
 * Vertical timbre axis: `0..1` with the top of the surface (`y = 0`) brightest.
 * Values outside `0..1` clamp.
 */
export function yToTimbre(y: number): number {
  if (y < 0) return 1
  if (y > 1) return 0
  return 1 - y
}

/**
 * Horizontal slide target: the cell one degree adjacent to `cell` in the sign
 * direction of `dir` (used for glide). Returns `null` at the grid edge or when
 * `dir` is 0 (no adjacent target).
 */
export function slideTargetCell(
  cell: CellRef,
  dir: number,
  config: SurfaceConfig,
): CellRef | null {
  const step = Math.sign(dir)
  if (step === 0) return null
  const col = cell.col + step
  if (col < 0 || col >= config.cols) return null
  return { row: cell.row, col }
}
