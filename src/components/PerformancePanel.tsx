/*
 * PerformancePanel — the play-shaping controls: arpeggiator, chord mode, latch,
 * and the phrase looper transport. Arp edits rebuild the whole ArpConfig and
 * call `setArp`; the transport buttons reflect `recorder.state` so the armed /
 * playing state is always visible.
 */
import {
  CloseIcon,
  IconButton,
  Knob,
  PlayIcon,
  RecordIcon,
  Segmented,
  Select,
  StopIcon,
  Toggle,
  ValueReadout,
} from './ui'
import type { SegmentedOption, SelectOption } from './ui'
import { useInstrument } from '../app/useInstrument'
import type { ArpConfig, ChordMode } from '../types'
import './panels.css'

const ARP_MODES: ReadonlyArray<SegmentedOption<ArpConfig['mode']>> = [
  { value: 'up', label: 'Up' },
  { value: 'down', label: 'Down' },
  { value: 'updown', label: 'Up/Down' },
  { value: 'random', label: 'Random' },
]

const CHORD_MODES: ReadonlyArray<SegmentedOption<ChordMode>> = [
  { value: 'off', label: 'Off' },
  { value: 'unison', label: 'Unison' },
  { value: 'fifth', label: 'Fifth' },
  { value: 'octave', label: 'Octave' },
  { value: 'triad', label: 'Triad' },
]

const DIVISIONS: ReadonlyArray<SelectOption<string>> = [
  { value: '1', label: '1/1' },
  { value: '2', label: '1/2' },
  { value: '4', label: '1/4' },
  { value: '8', label: '1/8' },
  { value: '16', label: '1/16' },
]

const pct = (v: number): string => `${Math.round(v * 100)}`

export function PerformancePanel() {
  const inst = useInstrument()
  const arp = inst.session.arp
  const { recorder } = inst

  const setArp = (p: Partial<ArpConfig>): void => inst.setArp({ ...arp, ...p })

  const recording = recorder.state === 'recording'
  const playing = recorder.state === 'playing'
  const hasPhrase = recorder.bars > 0

  return (
    <div className="pgroup-wrap">
      {/* Arpeggiator */}
      <section className="pgroup">
        <div className="transport__row" style={{ justifyContent: 'space-between' }}>
          <span className="pgroup__title eyebrow">Arpeggiator</span>
          <Toggle
            aria-label="Enable arpeggiator"
            checked={arp.enabled}
            onChange={(enabled) => setArp({ enabled })}
          />
        </div>
        <Segmented
          label="Arp mode"
          options={ARP_MODES}
          value={arp.mode}
          disabled={!arp.enabled}
          onChange={(mode) => setArp({ mode })}
        />
        <div className="pshelf">
          <Select
            label="Division"
            options={DIVISIONS}
            value={String(arp.division)}
            disabled={!arp.enabled}
            onChange={(v) => setArp({ division: Number(v) })}
          />
          <Knob
            label="Gate"
            unit="%"
            min={0}
            max={1}
            value={arp.gate}
            format={pct}
            disabled={!arp.enabled}
            onChange={(gate) => setArp({ gate })}
          />
          <Knob
            label="Swing"
            unit="%"
            min={0}
            max={1}
            value={arp.swing}
            format={pct}
            disabled={!arp.enabled}
            onChange={(swing) => setArp({ swing })}
          />
          <Knob
            label="Octaves"
            min={1}
            max={4}
            step={1}
            value={arp.octaves}
            format={(v) => `${Math.round(v)}`}
            disabled={!arp.enabled}
            onChange={(octaves) => setArp({ octaves: Math.round(octaves) })}
          />
        </div>
      </section>

      {/* Chord + latch */}
      <section className="pgroup">
        <span className="pgroup__title eyebrow">Chord</span>
        <Segmented
          label="Chord mode"
          hideLabel
          options={CHORD_MODES}
          value={inst.session.chordMode}
          onChange={(m) => inst.setChordMode(m)}
        />
        <Toggle
          label="Latch"
          hint="Held notes keep sounding after release"
          checked={inst.latch}
          onChange={(on) => inst.setLatch(on)}
        />
      </section>

      {/* Phrase looper */}
      <section className="pgroup">
        <div className="transport__row" style={{ justifyContent: 'space-between' }}>
          <span className="pgroup__title eyebrow">Phrase looper</span>
          <ValueReadout
            label="Length"
            value={hasPhrase ? recorder.bars : '—'}
            unit={hasPhrase ? 'bars' : undefined}
            tone={recording ? 'ember' : 'default'}
            size="sm"
          />
        </div>
        <div className="transport__row">
          <IconButton
            label={recording ? 'Stop recording' : 'Record phrase'}
            active={recording}
            onClick={() => inst.toggleRecordPhrase()}
          >
            <RecordIcon />
          </IconButton>
          <IconButton
            label={playing ? 'Stop playback' : 'Play phrase'}
            active={playing}
            disabled={!hasPhrase && !playing}
            onClick={() => inst.togglePlayPhrase()}
          >
            {playing ? <StopIcon /> : <PlayIcon />}
          </IconButton>
          <IconButton
            label="Clear phrase"
            disabled={!hasPhrase}
            onClick={() => inst.clearPhrase()}
          >
            <CloseIcon />
          </IconButton>
        </div>
        {!hasPhrase && !recording ? (
          <p className="pempty">No phrase yet. Hit record, play a line, then loop it.</p>
        ) : null}
      </section>
    </div>
  )
}
