/*
 * Surface — the mkeys playing surface and the app's visual identity.
 *
 * Renders `useInstrument().grid` as the hero isomorphic pad grid (or the piano
 * strip, per `session.surface.layout`), each pad tinted by its scale degree via
 * `degreeColor` with the tonic emphasised. Out-of-scale notes simply don't exist
 * here — the grid contains only playable cells.
 *
 * Interaction is Pointer-Events based for real multi-touch polyphony (up to
 * MAX_VOICES). Rather than per-pad handlers, the whole surface captures each
 * pointer and hit-tests by coordinate, so a touch can *slide* across pads — the
 * horizontal slide drives a pitch glide toward the adjacent degree, which is the
 * instrument's signature gesture (visualised by the GlideTrail overlay).
 *
 * Expression mapping (per touch, MPE-style):
 *   - horizontal slide from a pad centre -> pitch glide toward the neighbouring
 *     degree, quantised by `surface.quantize` (surfaceMath + surface/glide).
 *   - vertical position -> timbre (top brightest), via geometry `yToTimbre`.
 *   - pointer pressure -> pressure (fallback for devices that report none).
 *
 * Authoritative per-pointer bookkeeping lives in a ref (so event handlers never
 * read stale state and no voice is ever orphaned); a reducer bump drives the
 * visual re-render for the trail/readouts, which the store snapshot alone can't.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useInstrument } from '../../app/useInstrument'
import type { TouchExpression } from '../../types'
import { degreeColor } from '../../styles/palette'
import {
  effectiveSurface,
  pointerToCell,
  slideTargetCell,
  yToTimbre,
} from '../../surface/geometry'
import { glidePitch, slideColumnOffset } from './surfaceMath'
import { centsOffset, midiToNoteName } from './notes'
import { useReducedMotion } from './useReducedMotion'
import { GlideTrail, type TouchView } from './GlideTrail'
import './Surface.css'

/** Polyphony cap for concurrent touches. */
const MAX_VOICES = 8
/** Max retained points per fading trail. */
const TRAIL_MAX = 22

export interface SurfaceProps {
  /** Extra class(es) on the surface root; it always fills its container. */
  className?: string
}

/** Origin pad of a touch, captured at pointerdown. */
interface TouchOrigin {
  row: number
  col: number
  indexInScale: number
  octave: number
  midi: number
}

/** Live, mutable record for one active pointer. */
interface PointerRec {
  voiceId: number
  origin: TouchOrigin
  trail: Array<{ x: number; y: number }>
  x: number
  y: number
  label: string
  cents: number
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Pointer pressure, with a sensible constant for devices that report none. */
const readPressure = (e: ReactPointerEvent): number =>
  e.pressure > 0 ? e.pressure : 0.5

export function Surface({ className }: SurfaceProps) {
  const instrument = useInstrument()
  const { grid, activeVoices } = instrument
  // Same effective geometry the store built `grid` from (piano = one row), so
  // hit-testing and the CSS grid template always match the cells.
  const surface = effectiveSurface(instrument.session.surface)
  const reduced = useReducedMotion()

  const rootRef = useRef<HTMLDivElement>(null)
  const pointers = useRef<Map<number, PointerRec>>(new Map())
  const [, setTick] = useState(0)
  const bump = (): void => setTick((t) => t + 1)

  // Always release every live voice on unmount so nothing hangs; the latest
  // release fn is mirrored into a ref to avoid a stale closure at teardown.
  const noteOffRef = useRef(instrument.noteOffVoice)
  useEffect(() => {
    noteOffRef.current = instrument.noteOffVoice
  })
  useEffect(() => {
    const live = pointers.current
    return () => {
      for (const rec of live.values()) noteOffRef.current(rec.voiceId)
      live.clear()
    }
  }, [])

  // Number of degrees in the active scale, derived from the grid, for the hue
  // spread. (Cells index degrees 0..len-1; the max +1 recovers the length.)
  let scaleLength = 1
  for (const row of grid) {
    for (const cell of row) {
      if (cell.indexInScale + 1 > scaleLength) scaleLength = cell.indexInScale + 1
    }
  }

  // MIDI notes currently sounding, for pad highlight.
  const sounding = new Set<number>()
  for (const v of activeVoices.values()) sounding.add(v.midi)

  /** Normalised (0..1) pointer position within the surface, or null. */
  const coords = (e: ReactPointerEvent): { x: number; y: number } | null => {
    const el = rootRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return null
    return {
      x: clamp01((e.clientX - r.left) / r.width),
      y: clamp01((e.clientY - r.top) / r.height),
    }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (grid.length === 0) return
    if (pointers.current.size >= MAX_VOICES) return
    const el = rootRef.current
    if (!el) return
    const pos = coords(e)
    if (!pos) return
    const hit = pointerToCell(pos.x, pos.y, surface)
    if (!hit) return
    const cell = grid[hit.row]?.[hit.col]
    if (!cell) return

    void instrument.start()
    el.setPointerCapture(e.pointerId)

    const expr: TouchExpression = {
      pitch: cell.midi,
      glide: 0,
      timbre: yToTimbre(pos.y),
      pressure: readPressure(e),
    }
    const voiceId = instrument.noteOnAt(cell.indexInScale, cell.octave, expr)
    pointers.current.set(e.pointerId, {
      voiceId,
      origin: {
        row: hit.row,
        col: hit.col,
        indexInScale: cell.indexInScale,
        octave: cell.octave,
        midi: cell.midi,
      },
      trail: [{ x: pos.x, y: pos.y }],
      x: pos.x,
      y: pos.y,
      label: midiToNoteName(cell.midi),
      cents: 0,
    })
    bump()
    e.preventDefault()
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const rec = pointers.current.get(e.pointerId)
    if (!rec) return
    const pos = coords(e)
    if (!pos) return

    // Horizontal slide -> glide toward the adjacent degree (quantised).
    const offset = slideColumnOffset(pos.x, rec.origin.col, surface.cols)
    const target = slideTargetCell(
      { row: rec.origin.row, col: rec.origin.col },
      Math.sign(offset),
      surface,
    )
    const targetMidi = target
      ? grid[target.row]?.[target.col]?.midi ?? rec.origin.midi
      : rec.origin.midi
    const pitch = glidePitch(rec.origin.midi, targetMidi, offset, surface.quantize)

    instrument.moveVoice(rec.voiceId, {
      pitch,
      glide: pitch - rec.origin.midi,
      timbre: yToTimbre(pos.y),
      pressure: readPressure(e),
    })

    rec.x = pos.x
    rec.y = pos.y
    rec.label = midiToNoteName(pitch)
    rec.cents = centsOffset(pitch)
    if (!reduced) {
      rec.trail.push({ x: pos.x, y: pos.y })
      if (rec.trail.length > TRAIL_MAX) rec.trail.shift()
    }
    bump()
    e.preventDefault()
  }

  const endPointer = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const rec = pointers.current.get(e.pointerId)
    if (!rec) return
    instrument.noteOffVoice(rec.voiceId)
    pointers.current.delete(e.pointerId)
    const el = rootRef.current
    if (el && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    bump()
  }

  const touches: TouchView[] = []
  // Trail points are mutated imperatively in the pointer handlers (a ref, to stay
  // allocation-free at ~60fps) and surfaced to render via `bump()`. Reading the
  // ref here is the deliberate bridge from that imperative state into the trail
  // overlay; state would re-render on every pointermove.
  // eslint-disable-next-line react-hooks/refs
  for (const [id, rec] of pointers.current) {
    touches.push({
      id,
      points: rec.trail,
      x: rec.x,
      y: rec.y,
      label: rec.label,
      cents: rec.cents,
    })
  }

  const rootCls = ['surface', `surface--${surface.layout}`, className]
    .filter(Boolean)
    .join(' ')

  if (grid.length === 0) {
    return (
      <div className={rootCls} ref={rootRef} role="application" aria-label="Playing surface">
        <p className="surface__empty">No playable notes in this scale.</p>
      </div>
    )
  }

  // Render highest row index at the top: geometry maps y=0 (top) to the highest
  // row so higher-on-screen plays higher. Coordinate hit-testing is unaffected.
  const rowOrder: number[] = []
  for (let r = grid.length - 1; r >= 0; r--) rowOrder.push(r)

  return (
    <div
      className={rootCls}
      ref={rootRef}
      role="application"
      aria-label="Playing surface"
      style={{
        gridTemplateColumns: `repeat(${surface.cols}, 1fr)`,
        gridTemplateRows: `repeat(${surface.rows}, 1fr)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onLostPointerCapture={endPointer}
    >
      {rowOrder.map((r) =>
        grid[r].map((cell, c) => {
          const active = sounding.has(cell.midi)
          const cls = [
            'surface__pad',
            cell.isTonic ? 'is-tonic' : '',
            active ? 'is-active' : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <div
              key={`${r}-${c}`}
              className={cls}
              style={{
                background: degreeColor(cell.indexInScale, scaleLength, {
                  tonic: cell.isTonic,
                  active,
                }),
              }}
            >
              <span className="surface__label">{cell.label}</span>
            </div>
          )
        }),
      )}

      <GlideTrail touches={touches} showTrail={!reduced} />
    </div>
  )
}
