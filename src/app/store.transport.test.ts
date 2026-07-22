/**
 * Store transport correctness (§6 phrase-lookahead cancellation, §8 first note
 * during audio startup). Both need a deterministic engine, so `../audio` is
 * mocked with a fake whose `start()` can be gated, and `../transport/linkBridge`
 * is stubbed so `start()` never opens a real socket.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TouchExpression } from '../types'

/**
 * Fake NoteSink engine, defined in a hoisted block so the `vi.mock` factory
 * (hoisted above imports) can reference it. Records note-ons and lets a test
 * gate `start()` to model the async audio-startup gap (§8).
 */
const { FakeEngineCtor } = vi.hoisted(() => {
  class FakeEngine {
    masterGain: unknown = null
    running = false
    noteOnCalls: Array<{ id: number; midi: number; vel: number; freq?: number }> = []
    startCallCount = 0
    gate = false
    failNext = false
    private resolveStart: (() => void) | null = null

    start(): Promise<void> {
      this.startCallCount++
      if (this.failNext) {
        this.failNext = false
        return Promise.reject(new Error('init failed'))
      }
      if (!this.gate) {
        this.running = true
        return Promise.resolve()
      }
      return new Promise<void>((res) => {
        this.resolveStart = () => {
          this.running = true
          res()
        }
      })
    }
    releaseStart(): void {
      this.resolveStart?.()
    }
    noteOn(id: number, midi: number, vel: number, freq?: number): void {
      this.noteOnCalls.push({ id, midi, vel, freq })
    }
    noteOff(): void {}
    setExpression(): void {}
    setPatch(): void {}
    setFx(): void {}
    setMacros(): void {}
    setMasterVolume(): void {}
    setInputGain(): void {}
    setTempo(): void {}
    panic(): void {}
    getRecorder(): null {
      return null
    }
    latencyMs(): null {
      return null
    }
  }
  return { FakeEngineCtor: FakeEngine }
})

type FakeEngine = InstanceType<typeof FakeEngineCtor>

vi.mock('../audio', () => ({
  AudioEngine: FakeEngineCtor,
  getPreset: () => undefined,
}))

vi.mock('../transport/linkBridge', () => ({
  autoDetectLinkBridge: () => {},
  enableLinkBridge: () => {},
  getLinkState: () => ({
    tempo: 120,
    beat: 0,
    phase: 0,
    playing: false,
    peers: 0,
    clients: 0,
    connected: false,
  }),
  onLinkState: () => () => {},
  sendLinkTempo: () => {},
  sendLinkPlaying: () => {},
}))

// Import AFTER the mocks are registered (vi.mock is hoisted, but keep it explicit).
import { instrumentStore } from './store'

interface StorePrivates {
  engine: FakeEngine
  ctxNow(): number
  onPhraseEvents(events: Array<{ time: number; offTime: number; note: number; velocity: number; beat: number }>): void
  noteOnAt(indexInScale: number, octave: number, expr: TouchExpression): number
  phraseTable: Array<{ degree: number; octave: number; expr: TouchExpression }>
  phrasePending: Set<unknown>
  phraseVoiceIds: Set<number>
  voices: Map<number, unknown>
  recorderState: string
  startedFlag: boolean
  startPromise: Promise<void> | null
  linkEnabledFlag: boolean
  onLink(state: {
    tempo: number
    beat: number
    phase: number
    playing: boolean
    peers: number
    clients: number
    connected: boolean
  }): void
}

function linkState(connected: boolean, tempo: number) {
  return { tempo, beat: 0, phase: 0, playing: false, peers: connected ? 1 : 0, clients: 1, connected }
}

const priv = instrumentStore as unknown as StorePrivates
const EXPR: TouchExpression = { pitch: 60, glide: 0, timbre: 0.5, pressure: 0.8 }
const META = { degree: 0, octave: 4, expr: EXPR }

describe('§6 phrase lookahead cancellation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    instrumentStore.panic()
    priv.phraseTable = [META]
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('positive control: a scheduled phrase note-on fires and sounds a voice', () => {
    const now = priv.ctxNow()
    priv.recorderState = 'playing'
    priv.onPhraseEvents([{ time: now + 0.05, offTime: now + 0.5, note: 0, velocity: 0.8, beat: 0 }])
    expect(priv.phrasePending.size).toBe(2) // on + off
    vi.advanceTimersByTime(100) // past the 50 ms onset, before the 500 ms release
    expect(priv.phraseVoiceIds.size).toBe(1)
    expect(priv.voices.size).toBe(1)
  })

  it('Stop cancels pending note-ons so none fire after the transport stops', () => {
    const now = priv.ctxNow()
    priv.recorderState = 'playing'
    priv.onPhraseEvents([{ time: now + 0.05, offTime: now + 0.5, note: 0, velocity: 0.8, beat: 0 }])
    expect(priv.phrasePending.size).toBe(2)

    instrumentStore.togglePlayPhrase() // playing → stop
    expect(priv.phrasePending.size).toBe(0)

    vi.advanceTimersByTime(1000)
    expect(priv.phraseVoiceIds.size).toBe(0)
    expect(priv.voices.size).toBe(0)
  })

  it('Clear cancels pending note-ons and drops the phrase', () => {
    const now = priv.ctxNow()
    priv.recorderState = 'playing'
    priv.onPhraseEvents([{ time: now + 0.05, offTime: now + 0.5, note: 0, velocity: 0.8, beat: 0 }])
    instrumentStore.clearPhrase()
    expect(priv.phrasePending.size).toBe(0)
    vi.advanceTimersByTime(1000)
    expect(priv.voices.size).toBe(0)
    expect(instrumentStore.getSnapshot().session.phrase).toBeNull()
  })

  it('Panic cancels pending note-ons', () => {
    const now = priv.ctxNow()
    priv.recorderState = 'playing'
    priv.onPhraseEvents([{ time: now + 0.05, offTime: now + 0.5, note: 0, velocity: 0.8, beat: 0 }])
    instrumentStore.panic()
    expect(priv.phrasePending.size).toBe(0)
    vi.advanceTimersByTime(1000)
    expect(priv.voices.size).toBe(0)
  })

  it('starting a record while playing cancels pending playback note-ons', () => {
    const now = priv.ctxNow()
    priv.recorderState = 'playing'
    priv.onPhraseEvents([{ time: now + 0.05, offTime: now + 0.5, note: 0, velocity: 0.8, beat: 0 }])
    instrumentStore.toggleRecordPhrase() // stops the playing loop, arms recording
    expect(priv.phrasePending.size).toBe(0)
    expect(priv.recorderState).toBe('recording')
    vi.advanceTimersByTime(1000)
    // No stray playback voice bled into the take.
    expect(priv.phraseVoiceIds.size).toBe(0)
  })
})

describe('§2 Ableton Link tempo ownership', () => {
  beforeEach(() => {
    instrumentStore.panic()
    // Start every case Link-disabled and disconnected at a known local tempo.
    if (priv.linkEnabledFlag) instrumentStore.toggleLink()
    priv.onLink(linkState(false, 120))
    instrumentStore.setBpm(100)
  })

  it('auto-detected (connected) but not enabled does NOT take tempo', () => {
    priv.onLink(linkState(true, 140)) // bridge auto-detected + connected
    expect(instrumentStore.getSnapshot().link.connected).toBe(true)
    expect(instrumentStore.getSnapshot().link.enabled).toBe(false)
    expect(instrumentStore.getSnapshot().effectiveBpm).toBe(100) // local still owns
  })

  it('local + tap tempo always work while Link is off', () => {
    priv.onLink(linkState(true, 140)) // connected but disabled
    instrumentStore.setBpm(85)
    expect(instrumentStore.getSnapshot().effectiveBpm).toBe(85)
  })

  it('enabling Link while connected adopts the shared tempo', () => {
    priv.onLink(linkState(true, 140))
    instrumentStore.toggleLink() // user enables Link
    expect(instrumentStore.getSnapshot().link.enabled).toBe(true)
    expect(instrumentStore.getSnapshot().effectiveBpm).toBe(140)
  })

  it('disabling Link immediately restores the stored local BPM', () => {
    priv.onLink(linkState(true, 140))
    instrumentStore.toggleLink() // enable → 140
    expect(instrumentStore.getSnapshot().effectiveBpm).toBe(140)
    instrumentStore.toggleLink() // disable → back to local 100
    expect(instrumentStore.getSnapshot().effectiveBpm).toBe(100)
  })

  it('a disconnect while enabled falls back to local; reconnect re-adopts', () => {
    priv.onLink(linkState(true, 140))
    instrumentStore.toggleLink() // enabled + connected → 140
    expect(instrumentStore.getSnapshot().effectiveBpm).toBe(140)
    priv.onLink(linkState(false, 140)) // bridge dropped
    expect(instrumentStore.getSnapshot().effectiveBpm).toBe(100) // local fallback
    priv.onLink(linkState(true, 128)) // reconnect at a new tempo
    expect(instrumentStore.getSnapshot().effectiveBpm).toBe(128)
  })
})

describe('§8 first keyboard note during audio startup', () => {
  beforeEach(() => {
    // Reset the shared singleton's start state between cases.
    priv.startedFlag = false
    priv.startPromise = null
    priv.engine.gate = false
    priv.engine.failNext = false
    priv.engine.noteOnCalls = []
    priv.engine.startCallCount = 0
    instrumentStore.panic()
  })

  it('a note pressed before startup completes sounds once audio is running', async () => {
    priv.engine.gate = true
    const startP = instrumentStore.start()
    expect(instrumentStore.getSnapshot().started).toBe(false)

    // Press during the async startup gap — engine calls are no-ops now.
    priv.noteOnAt(2, 4, EXPR)
    priv.engine.noteOnCalls = [] // capture only the post-start replay

    priv.engine.releaseStart()
    await startP

    expect(instrumentStore.getSnapshot().started).toBe(true)
    expect(priv.engine.noteOnCalls.length).toBe(1) // the held voice re-sounded
  })

  it('a key released before startup completes never sounds', async () => {
    priv.engine.gate = true
    const startP = instrumentStore.start()
    const vId = priv.noteOnAt(2, 4, EXPR)
    instrumentStore.noteOffVoice(vId) // early keyup before init finishes
    priv.engine.noteOnCalls = []

    priv.engine.releaseStart()
    await startP

    expect(priv.engine.noteOnCalls.length).toBe(0) // nothing replayed
    expect(priv.voices.size).toBe(0)
  })

  it('multiple keys during startup all sound, no duplicates', async () => {
    priv.engine.gate = true
    const startP = instrumentStore.start()
    priv.noteOnAt(0, 4, EXPR)
    priv.noteOnAt(2, 4, EXPR)
    priv.noteOnAt(4, 4, EXPR)
    priv.engine.noteOnCalls = []

    priv.engine.releaseStart()
    await startP

    expect(priv.engine.noteOnCalls.length).toBe(3)
    expect(priv.voices.size).toBe(3)
  })

  it('a double start builds the engine only once', async () => {
    const p1 = instrumentStore.start()
    const p2 = instrumentStore.start()
    expect(p1).toBe(p2)
    await p1
    expect(priv.engine.startCallCount).toBe(1)
  })

  it('a failed start clears state and a retry succeeds', async () => {
    priv.engine.failNext = true
    await expect(instrumentStore.start()).rejects.toThrow()
    expect(instrumentStore.getSnapshot().started).toBe(false)
    expect(priv.startPromise).toBeNull() // temporary state cleared → retry allowed

    await instrumentStore.start() // retry
    expect(instrumentStore.getSnapshot().started).toBe(true)
  })
})
