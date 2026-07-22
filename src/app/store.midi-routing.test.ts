/**
 * Professional MIDI routing (§12): device selection, input-channel filtering,
 * single-output routing, disconnected-device handling, hotplug via
 * onstatechange, and panic-before-output-change. Uses a fake MIDIAccess.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { MidiConfig, TouchExpression } from '../types'
import { instrumentStore } from './store'

class FakeInput {
  onmidimessage: ((e: { data: Uint8Array }) => void) | null = null
  constructor(
    public id: string,
    public name: string,
  ) {}
  feed(bytes: number[]): void {
    this.onmidimessage?.({ data: new Uint8Array(bytes) })
  }
}
class FakeOutput {
  sent: number[][] = []
  constructor(
    public id: string,
    public name: string,
  ) {}
  send(m: number[]): void {
    this.sent.push([...m])
  }
}
class FakeAccess {
  inputs = new Map<string, FakeInput>()
  outputs = new Map<string, FakeOutput>()
  onstatechange: (() => void) | null = null
}

interface Priv {
  midiAccess: unknown
  midiReadyFlag: boolean
  refreshMidiPorts(): void
  wireMidiInputs(): void
  onMidiStateChange(): void
  voices: Map<number, unknown>
  midiInVoices: Map<string, unknown>
  noteOnAt(i: number, o: number, e: TouchExpression): number
}
const priv = instrumentStore as unknown as Priv

const EXPR: TouchExpression = { pitch: 60, glide: 0, timbre: 0.5, pressure: 0.8 }
const BASE: MidiConfig = {
  inEnabled: true,
  outEnabled: false,
  inputId: null,
  inputChannel: 0,
  outputId: null,
  outChannel: 1,
  mpe: false,
}
const noteOn = (ch: number, note: number): number[] => [0x90 | ch, note, 100]
const isNoteOn = (m: number[]): boolean => (m[0] & 0xf0) === 0x90
const isNoteOff = (m: number[]): boolean => (m[0] & 0xf0) === 0x80

let access: FakeAccess

function install(): void {
  access = new FakeAccess()
  access.inputs.set('in-A', new FakeInput('in-A', 'Keystation'))
  access.inputs.set('in-B', new FakeInput('in-B', 'Push'))
  access.outputs.set('out-A', new FakeOutput('out-A', 'Synth A'))
  access.outputs.set('out-B', new FakeOutput('out-B', 'Synth B'))
  priv.midiAccess = access
  priv.midiReadyFlag = true
  access.onstatechange = () => priv.onMidiStateChange()
}

const inA = (): FakeInput => access.inputs.get('in-A')!
const inB = (): FakeInput => access.inputs.get('in-B')!
const outA = (): FakeOutput => access.outputs.get('out-A')!
const outB = (): FakeOutput => access.outputs.get('out-B')!

beforeEach(() => {
  instrumentStore.panic()
  install()
})

describe('§12 port enumeration', () => {
  it('exposes connected inputs and outputs', () => {
    instrumentStore.setMidiConfig(BASE)
    const snap = instrumentStore.getSnapshot()
    expect(snap.midiInputs.map((p) => p.id).sort()).toEqual(['in-A', 'in-B'])
    expect(snap.midiOutputs.map((p) => p.id).sort()).toEqual(['out-A', 'out-B'])
    expect(snap.midiInputs.every((p) => p.connected)).toBe(true)
  })
})

describe('§12 input device selection', () => {
  it('wires only the selected input; deselected inputs are silenced', () => {
    instrumentStore.setMidiConfig({ ...BASE, inputId: 'in-A' })
    expect(typeof inA().onmidimessage).toBe('function')
    expect(inB().onmidimessage).toBeNull()

    inB().feed(noteOn(0, 60)) // deselected device — ignored
    expect(priv.voices.size).toBe(0)
    inA().feed(noteOn(0, 60)) // selected — plays
    expect(priv.voices.size).toBe(1)
  })

  it('null inputId listens to all inputs', () => {
    instrumentStore.setMidiConfig({ ...BASE, inputId: null })
    inB().feed(noteOn(0, 62))
    expect(priv.voices.size).toBe(1)
  })
})

describe('§12 input channel filter', () => {
  it('Omni accepts every channel', () => {
    instrumentStore.setMidiConfig({ ...BASE, inputChannel: 0 })
    inA().feed(noteOn(5, 60))
    expect(priv.voices.size).toBe(1)
  })
  it('a specific channel rejects other channels', () => {
    instrumentStore.setMidiConfig({ ...BASE, inputChannel: 2 }) // channel 2 → ev.channel 1
    inA().feed(noteOn(0, 60)) // channel 1 → ignored
    expect(priv.voices.size).toBe(0)
    inA().feed(noteOn(1, 60)) // channel 2 → accepted
    expect(priv.voices.size).toBe(1)
  })
})

describe('§12 output routing', () => {
  it('sends only to the selected output, not every port', () => {
    instrumentStore.setMidiConfig({ ...BASE, inEnabled: false, outEnabled: true, outputId: 'out-B' })
    priv.noteOnAt(0, 4, EXPR)
    expect(outB().sent.some(isNoteOn)).toBe(true)
    expect(outA().sent.length).toBe(0)
  })

  it('a disconnected selected output routes nowhere and warns', () => {
    instrumentStore.setMidiConfig({ ...BASE, inEnabled: false, outEnabled: true, outputId: 'ghost' })
    priv.noteOnAt(0, 4, EXPR)
    expect(outA().sent.length).toBe(0)
    expect(outB().sent.length).toBe(0)
    const snap = instrumentStore.getSnapshot()
    expect(snap.midiOutputs.some((p) => p.id === 'ghost' && !p.connected)).toBe(true)
    expect(snap.midiRoutingWarning).toMatch(/disconnected/i)
  })
})

describe('§12 hotplug via onstatechange', () => {
  it('re-enumerates on connect and does not stack input handlers', () => {
    instrumentStore.setMidiConfig({ ...BASE, inputId: null })
    access.inputs.set('in-C', new FakeInput('in-C', 'Seaboard'))
    access.onstatechange?.() // device connected
    expect(instrumentStore.getSnapshot().midiInputs.some((p) => p.id === 'in-C')).toBe(true)

    // A single note-on yields exactly one voice — no duplicate handler.
    access.inputs.get('in-C')!.feed(noteOn(0, 64))
    expect(priv.voices.size).toBe(1)
  })
})

describe('§12 panic before an output change', () => {
  it('flushes note-offs to the current output before switching device', () => {
    instrumentStore.setMidiConfig({ ...BASE, inEnabled: false, outEnabled: true, outputId: 'out-A' })
    priv.noteOnAt(0, 4, EXPR)
    expect(outA().sent.some(isNoteOn)).toBe(true)
    // Switching the output device must panic the old destination first.
    instrumentStore.setMidiConfig({ ...BASE, inEnabled: false, outEnabled: true, outputId: 'out-B' })
    expect(outA().sent.some(isNoteOff)).toBe(true)
  })
})
