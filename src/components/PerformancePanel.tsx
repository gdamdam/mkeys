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
  Slider,
  StopIcon,
  Toggle,
  ValueReadout,
} from './ui'
import type { SegmentedOption, SelectOption } from './ui'
import { useInstrument } from '../app/useInstrument'
import type { ArpConfig, ChordMode, PlayGrid, PlayTimingMode } from '../types'
import './panels.css'

const TIMING_MODES: ReadonlyArray<SegmentedOption<PlayTimingMode>> = [
  { value: 'immediate', label: 'Immediate' },
  { value: 'recording', label: 'Quantized rec' },
  { value: 'live', label: 'Quantized live' },
]

const PLAY_GRID_OPTIONS: ReadonlyArray<SelectOption<PlayGrid>> = [
  { value: 'off', label: 'Off' },
  { value: '1/16', label: '1/16' },
  { value: '1/8', label: '1/8' },
  { value: '1/4', label: '1/4' },
  { value: 'beat', label: 'Beat' },
  { value: 'bar', label: 'Bar' },
]

const TIMING_HELP: Record<PlayTimingMode, string> = {
  immediate: 'Notes sound the instant you play them.',
  recording: 'Monitoring stays live; captured phrase notes snap to the grid. Best for tight loops.',
  live: 'Notes wait for the next grid boundary before sounding — play ahead of the beat.',
}

const ARP_MODES: ReadonlyArray<SegmentedOption<ArpConfig['mode']>> = [
  { value: 'up', label: 'Up' },
  { value: 'down', label: 'Down' },
  { value: 'updown', label: 'Up/Down' },
  { value: 'random', label: 'Random' },
]

// §7: 'unison' is intentionally absent — it duplicated 'off' (patch unison does
// the thickening). Stored/shared 'unison' values migrate to 'off' in the sanitizer.
const CHORD_MODES: ReadonlyArray<SegmentedOption<ChordMode>> = [
  { value: 'off', label: 'Off' },
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
  const surface = inst.session.surface
  const pq = inst.session.playQuantize
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

      {/* Play quantize (§24) — TIMING of notes on the musical grid. Distinct from
          the Glide quantize below, which shapes PITCH movement between degrees. */}
      <section className="pgroup">
        <span className="pgroup__title eyebrow">Play quantize</span>
        <Segmented
          label="Timing"
          options={TIMING_MODES}
          value={pq.mode}
          onChange={(mode) => inst.setPlayQuantize({ ...pq, mode })}
        />
        <div className="pshelf">
          <Select
            label="Grid"
            options={PLAY_GRID_OPTIONS}
            value={pq.grid}
            // Immediate mode ignores the grid entirely, so disable it there.
            disabled={pq.mode === 'immediate'}
            onChange={(grid) => inst.setPlayQuantize({ ...pq, grid })}
          />
        </div>
        <p className="pempty" style={{ margin: '2px 0 0' }}>
          {TIMING_HELP[pq.mode]}
        </p>
      </section>

      {/* Playing surface — glide quantize (advertised 0–100%) + advanced geometry */}
      <section className="pgroup">
        <span className="pgroup__title eyebrow">Playing surface</span>
        <Slider
          label="Glide quantize"
          min={0}
          max={1}
          step={0.01}
          value={surface.quantize}
          unit="%"
          format={(v) => `${Math.round(v * 100)}`}
          onChange={(v) => inst.setQuantize(v)}
        />
        <p className="pempty" style={{ margin: '2px 0 0' }}>
          0% glides continuously between degrees · 100% snaps in steps.
        </p>
        <details className="padvanced">
          <summary className="eyebrow">Advanced layout</summary>
          <div className="pshelf">
            <Knob
              label="Rows"
              min={1}
              max={12}
              step={1}
              value={surface.rows}
              format={(v) => `${Math.round(v)}`}
              onChange={(v) => inst.setSurfaceGeometry({ rows: Math.round(v) })}
            />
            <Knob
              label="Columns"
              min={1}
              max={24}
              step={1}
              value={surface.cols}
              format={(v) => `${Math.round(v)}`}
              onChange={(v) => inst.setSurfaceGeometry({ cols: Math.round(v) })}
            />
            <Knob
              label="Row offset"
              min={0}
              max={12}
              step={1}
              value={surface.rowOffsetDegrees}
              format={(v) => `${Math.round(v)}`}
              onChange={(v) => inst.setSurfaceGeometry({ rowOffsetDegrees: Math.round(v) })}
            />
          </div>
        </details>
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
