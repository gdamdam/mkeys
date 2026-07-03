import { describe, expect, it } from 'vitest'

import {
  allNotesOffBytes,
  noteOffBytes,
  noteOnBytes,
  pitchBendBytes,
} from './emit'
import { NoteOwnership } from './ownership'
import { parseMidiMessage } from './parse'

describe('parseMidiMessage', () => {
  it('parses a note-on with velocity', () => {
    const ev = parseMidiMessage([0x92, 60, 100])
    expect(ev).toEqual({ type: 'noteOn', channel: 2, note: 60, velocity: 100 })
  })

  it('treats note-on velocity 0 as note-off', () => {
    const ev = parseMidiMessage([0x90, 60, 0])
    expect(ev).toEqual({ type: 'noteOff', channel: 0, note: 60, velocity: 0 })
  })

  it('parses an explicit note-off (0x80) keeping its release velocity', () => {
    const ev = parseMidiMessage([0x81, 64, 40])
    expect(ev).toEqual({ type: 'noteOff', channel: 1, note: 64, velocity: 40 })
  })

  it('recognizes the mod wheel (CC1)', () => {
    const ev = parseMidiMessage([0xb0, 1, 77])
    expect(ev).toEqual({
      type: 'controlChange',
      channel: 0,
      controller: 1,
      value: 77,
      kind: 'modWheel',
    })
  })

  it('recognizes sustain (CC64)', () => {
    const ev = parseMidiMessage([0xb5, 64, 127])
    expect(ev).toEqual({
      type: 'controlChange',
      channel: 5,
      controller: 64,
      value: 127,
      kind: 'sustain',
    })
  })

  it('classifies other CCs as "other"', () => {
    const ev = parseMidiMessage([0xb0, 7, 100])
    expect(ev).toMatchObject({ type: 'controlChange', controller: 7, kind: 'other' })
  })

  it('parses pitch bend center as ~0', () => {
    const ev = parseMidiMessage([0xe0, 0x00, 0x40]) // lsb=0, msb=64 -> raw 8192
    expect(ev?.type).toBe('pitchBend')
    if (ev?.type === 'pitchBend') expect(ev.value).toBeCloseTo(0, 6)
  })

  it('parses pitch bend extremes to -1 and +1', () => {
    const down = parseMidiMessage([0xe0, 0x00, 0x00]) // raw 0
    const up = parseMidiMessage([0xe0, 0x7f, 0x7f]) // raw 16383
    if (down?.type === 'pitchBend') expect(down.value).toBeCloseTo(-1, 6)
    if (up?.type === 'pitchBend') expect(up.value).toBeCloseTo(1, 6)
  })

  it('accepts Uint8Array input', () => {
    const ev = parseMidiMessage(new Uint8Array([0x90, 60, 100]))
    expect(ev).toEqual({ type: 'noteOn', channel: 0, note: 60, velocity: 100 })
  })

  it('returns null for empty / truncated / running-status / unknown messages', () => {
    expect(parseMidiMessage([])).toBeNull()
    expect(parseMidiMessage([0x90, 60])).toBeNull() // truncated
    expect(parseMidiMessage([60, 100])).toBeNull() // running status (no status byte)
    expect(parseMidiMessage([0xf0, 0x7f])).toBeNull() // sysex / unhandled
    expect(parseMidiMessage([0x90, 0x80, 10])).toBeNull() // data byte with high bit set
  })
})

describe('emit', () => {
  it('emits note-on with correct status nibble and channel', () => {
    expect(noteOnBytes(60, 100, 2)).toEqual([0x92, 60, 100])
  })

  it('emits note-off with 0x80 status', () => {
    expect(noteOffBytes(64, 1)).toEqual([0x81, 64, 0])
  })

  it('emits all-notes-off as CC123', () => {
    expect(allNotesOffBytes(3)).toEqual([0xb3, 123, 0])
  })

  it('clamps note, velocity and channel to valid ranges', () => {
    expect(noteOnBytes(200, 500, 99)).toEqual([0x9f, 127, 127])
    expect(noteOnBytes(-5, -5, -5)).toEqual([0x90, 0, 0])
  })

  it('emits pitch bend center / extremes correctly', () => {
    expect(pitchBendBytes(0, 0)).toEqual([0xe0, 0x00, 0x40]) // 8192
    expect(pitchBendBytes(-1, 0)).toEqual([0xe0, 0x00, 0x00]) // 0
    expect(pitchBendBytes(1, 0)).toEqual([0xe0, 0x7f, 0x7f]) // 16383
  })

  it('clamps pitch bend out-of-range values', () => {
    expect(pitchBendBytes(5, 0)).toEqual([0xe0, 0x7f, 0x7f])
    expect(pitchBendBytes(-5, 0)).toEqual([0xe0, 0x00, 0x00])
  })
})

describe('parse/emit round-trips', () => {
  it('round-trips note-on', () => {
    for (const [note, vel, ch] of [
      [60, 100, 0],
      [21, 1, 9],
      [108, 127, 15],
    ]) {
      expect(parseMidiMessage(noteOnBytes(note, vel, ch))).toEqual({
        type: 'noteOn',
        channel: ch,
        note,
        velocity: vel,
      })
    }
  })

  it('round-trips note-off', () => {
    expect(parseMidiMessage(noteOffBytes(72, 4))).toEqual({
      type: 'noteOff',
      channel: 4,
      note: 72,
      velocity: 0,
    })
  })

  it('round-trips pitch bend values within rounding tolerance', () => {
    for (const v of [-1, -0.5, -0.1, 0, 0.1, 0.5, 1]) {
      const ev = parseMidiMessage(pitchBendBytes(v, 7))
      expect(ev?.type).toBe('pitchBend')
      if (ev?.type === 'pitchBend') {
        expect(ev.channel).toBe(7)
        expect(ev.value).toBeCloseTo(v, 3)
      }
    }
  })
})

describe('NoteOwnership', () => {
  it('registers a note-on and matches its note-off, preventing orphans', () => {
    const own = new NoteOwnership()
    const on = own.noteOn(1, 60, 100, 0)
    expect(on).toEqual([[0x90, 60, 100]])
    expect(own.activeCount()).toBe(1)

    const off = own.noteOff(1)
    expect(off).toEqual([[0x80, 60, 0]])
    expect(own.activeCount()).toBe(0)
  })

  it('ignores a note-off for an unknown voice (no orphan off emitted)', () => {
    const own = new NoteOwnership()
    expect(own.noteOff(999)).toEqual([])
    expect(own.activeCount()).toBe(0)
  })

  it('re-triggers safely when the same voice fires a second note-on', () => {
    const own = new NoteOwnership()
    own.noteOn(1, 60, 100, 0)
    const retrig = own.noteOn(1, 67, 90, 0) // same voice, new pitch
    expect(retrig).toEqual([
      [0x80, 60, 0], // off for the old note first
      [0x90, 67, 90], // then the new note
    ])
    expect(own.activeCount()).toBe(1)
    expect(own.isSounding(60, 0)).toBe(false)
    expect(own.isSounding(67, 0)).toBe(true)
  })

  it('re-triggers safely when a duplicate note-on hits an already-sounding pitch', () => {
    const own = new NoteOwnership()
    own.noteOn(1, 60, 100, 0)
    const dup = own.noteOn(2, 60, 110, 0) // different voice, same pitch
    expect(dup).toEqual([
      [0x80, 60, 0], // kill the sounding note first
      [0x90, 60, 110], // retrigger
    ])
    expect(own.activeCount()).toBe(1)
    // Old voice must no longer own the note -> no hung note.
    expect(own.noteOff(1)).toEqual([])
    expect(own.noteOff(2)).toEqual([[0x80, 60, 0]])
  })

  it('keeps notes on different channels independent', () => {
    const own = new NoteOwnership()
    own.noteOn(1, 60, 100, 0)
    const other = own.noteOn(2, 60, 100, 1) // same pitch, different channel
    expect(other).toEqual([[0x91, 60, 100]]) // no retrigger
    expect(own.activeCount()).toBe(2)
  })

  it('panic clears everything and yields an off for every held note', () => {
    const own = new NoteOwnership()
    own.noteOn(1, 60, 100, 0)
    own.noteOn(2, 64, 100, 0)
    own.noteOn(3, 67, 100, 1)

    const offs = own.panic()
    expect(offs).toHaveLength(3)
    expect(offs).toContainEqual([0x80, 60, 0])
    expect(offs).toContainEqual([0x80, 64, 0])
    expect(offs).toContainEqual([0x81, 67, 0])
    expect(own.activeCount()).toBe(0)

    // After panic there is nothing left to turn off.
    expect(own.noteOff(1)).toEqual([])
    expect(own.panic()).toEqual([])
  })

  it('allNotesOff behaves like panic', () => {
    const own = new NoteOwnership()
    own.noteOn(1, 60, 100, 0)
    expect(own.allNotesOff()).toEqual([[0x80, 60, 0]])
    expect(own.activeCount()).toBe(0)
  })
})
