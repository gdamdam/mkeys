/**
 * useKeyboardPlay — computer-keyboard performance mapping.
 *
 * Maps two QWERTY rows onto the first two rows of the instrument surface so the
 * keys can be played without a pointer or MIDI controller:
 *
 *   home row   a s d f g h j k l ;   → surface row 0 (lower), columns 0..9
 *   upper row  q w e r t y u i o p   → surface row 1 (higher), columns 0..9
 *
 * Each key drives one logical voice via {@link Instrument.noteOnAt} /
 * {@link Instrument.noteOffVoice}. Auto-repeat is suppressed (a held key sounds
 * once), keystrokes are ignored while a text field is focused, and losing window
 * focus releases everything so no note hangs. Listeners bind once; the latest
 * instrument snapshot is read through a ref.
 */
import { useEffect, useRef } from 'react'
import type { Instrument } from '../components/instrument'
import type { TouchExpression } from '../types'

/** Grid column order for each mapped keyboard row. */
const LOWER_ROW = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';'] as const
const UPPER_ROW = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'] as const

/** key → { row, col } into the surface grid. */
const KEY_MAP: ReadonlyMap<string, { row: number; col: number }> = (() => {
  const map = new Map<string, { row: number; col: number }>()
  LOWER_ROW.forEach((k, col) => map.set(k, { row: 0, col }))
  UPPER_ROW.forEach((k, col) => map.set(k, { row: 1, col }))
  return map
})()

/** Default expression for a keyboard press (no pressure/timbre sensing). */
function keyExpression(midi: number): TouchExpression {
  return { pitch: midi, glide: 0, timbre: 0.5, pressure: 0.85 }
}

/** True when the event target is a text-entry surface we must not hijack. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export function useKeyboardPlay(instrument: Instrument): void {
  const ref = useRef(instrument)
  useEffect(() => {
    ref.current = instrument
  })

  useEffect(() => {
    const pressed = new Map<string, number>()

    const releaseAll = (): void => {
      for (const id of pressed.values()) ref.current.noteOffVoice(id)
      pressed.clear()
    }

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      if (isEditable(e.target)) return
      const key = e.key.toLowerCase()
      const pos = KEY_MAP.get(key)
      if (!pos || pressed.has(key)) return
      const cell = ref.current.grid[pos.row]?.[pos.col]
      if (!cell) return
      e.preventDefault()
      const id = ref.current.noteOnAt(cell.indexInScale, cell.octave, keyExpression(cell.midi))
      pressed.set(key, id)
    }

    const onKeyUp = (e: KeyboardEvent): void => {
      const key = e.key.toLowerCase()
      const id = pressed.get(key)
      if (id === undefined) return
      pressed.delete(key)
      ref.current.noteOffVoice(id)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', releaseAll)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', releaseAll)
      releaseAll()
    }
  }, [])
}
