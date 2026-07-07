/*
 * TransportBar — the always-visible top strip. Wordmark, musical key + scale,
 * tempo (with tap + Link mirroring), Link status, MIDI routing and the surface
 * layout switch. Everything here reads `session.*` / transient hook fields and
 * calls the store actions; it never owns state.
 */
import { Segmented, Select, Slider, Toggle } from './ui'
import type { SegmentedOption, SelectOption } from './ui'
import { useInstrument } from '../app/useInstrument'
import { MODES } from '../types'
import type { Mode, PitchClass, SurfaceConfig } from '../types'
import './panels.css'

/** Chromatic note names, index = pitch class (sharps spelling). */
const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

const MODE_LABELS: Record<Mode, string> = {
  major: 'Major',
  'natural-minor': 'Minor',
  dorian: 'Dorian',
  mixolydian: 'Mixolydian',
  phrygian: 'Phrygian',
  lydian: 'Lydian',
  'harmonic-minor': 'Harmonic minor',
  'pentatonic-major': 'Pentatonic major',
  'pentatonic-minor': 'Pentatonic minor',
  blues: 'Blues',
}

const KEY_OPTIONS: ReadonlyArray<SegmentedOption<string>> = KEY_NAMES.map((label, i) => ({
  value: String(i),
  label,
}))

const MODE_OPTIONS: ReadonlyArray<SelectOption<Mode>> = MODES.map((m) => ({
  value: m,
  label: MODE_LABELS[m],
}))

const LAYOUT_OPTIONS: ReadonlyArray<SegmentedOption<SurfaceConfig['layout']>> = [
  { value: 'grid', label: 'Grid' },
  { value: 'piano', label: 'Piano' },
]

const MIDI_CHANNELS: ReadonlyArray<SelectOption<string>> = Array.from({ length: 16 }, (_, i) => ({
  value: String(i + 1),
  label: `Ch ${i + 1}`,
}))

export function TransportBar() {
  const inst = useInstrument()
  const { session, link } = inst
  const linkDrivesTempo = link.enabled && link.connected

  let linkPill: { text: string; cls: string }
  if (!link.enabled) linkPill = { text: 'Link off', cls: 'pill' }
  else if (!link.connected) linkPill = { text: 'searching…', cls: 'pill pill--searching' }
  else
    linkPill = {
      text: `linked · ${link.peers} ${link.peers === 1 ? 'peer' : 'peers'}`,
      cls: 'pill pill--live',
    }

  return (
    <div className="transport">
      <h1 className="transport__wordmark">
        <img src={`${import.meta.env.BASE_URL}mkeys-wordmark.svg`} alt="mkeys" width={120} height={40} />
      </h1>

      {/* master output level + pre-FX input gain */}
      <div className="transport__block levels">
        <Slider
          label="Master"
          min={0}
          max={1}
          step={0.01}
          value={session.masterVolume}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => inst.setMasterVolume(v)}
        />
        <Slider
          label="Gain"
          min={0}
          max={2}
          step={0.01}
          value={session.inputGain}
          format={(v) => `${v.toFixed(2)}×`}
          onChange={(v) => inst.setInputGain(v)}
        />
      </div>

      {/* key + scale */}
      <div className="transport__block keystrip">
        <Segmented
          label="Key"
          options={KEY_OPTIONS}
          value={String(session.keyRoot)}
          onChange={(v) => inst.setKeyRoot(Number(v) as PitchClass)}
        />
      </div>
      <div className="transport__block">
        <Select
          label="Scale"
          options={MODE_OPTIONS}
          value={session.mode}
          onChange={(m) => inst.setMode(m)}
        />
      </div>

      {/* tempo */}
      <div className="transport__block">
        <Slider
          label="Tempo"
          min={40}
          max={240}
          step={1}
          value={inst.bpm}
          unit="bpm"
          disabled={linkDrivesTempo}
          format={() => Math.round(inst.effectiveBpm)}
          onChange={(v) => inst.setBpm(v)}
        />
        <div className="transport__row">
          <button
            type="button"
            className="pbtn"
            onClick={() => inst.tapTempo()}
            disabled={linkDrivesTempo}
          >
            Tap
          </button>
          <span className={linkPill.cls}>
            <span className="pill__dot" />
            {linkPill.text}
          </span>
          <Toggle
            aria-label="Ableton Link"
            checked={link.enabled}
            onChange={() => inst.toggleLink()}
          />
        </div>
        <div
          className="transport__row"
          title={
            inst.mbusPublishing
              ? 'Publishing the master output to the mbus patchbay (via the local link-bridge)'
              : 'Publish the master output to the mbus patchbay (needs the local link-bridge; harmless without it)'
          }
        >
          <span className={inst.mbusPublishing ? 'pill pill--live' : 'pill'}>
            <span className="pill__dot" />
            {inst.mbusPublishing ? 'bus on' : 'bus'}
          </span>
          <Toggle
            aria-label="Publish to mbus"
            checked={inst.mbusPublishing}
            onChange={() => inst.toggleMbusPublish()}
          />
        </div>
      </div>

      {/* MIDI */}
      <div className="transport__block">
        {inst.midiReady ? (
          <div className="transport__row">
            <Toggle
              label="MIDI in"
              checked={session.midi.inEnabled}
              onChange={(v) => inst.setMidiConfig({ ...session.midi, inEnabled: v })}
            />
            <Toggle
              label="MIDI out"
              checked={session.midi.outEnabled}
              onChange={(v) => inst.setMidiConfig({ ...session.midi, outEnabled: v })}
            />
            <Select
              label="Out channel"
              options={MIDI_CHANNELS}
              value={String(session.midi.outChannel)}
              disabled={!session.midi.outEnabled}
              onChange={(v) => inst.setMidiConfig({ ...session.midi, outChannel: Number(v) })}
            />
          </div>
        ) : (
          <button type="button" className="pbtn" onClick={() => void inst.enableMidi()}>
            Enable MIDI
          </button>
        )}
      </div>

      {/* layout */}
      <div className="transport__block">
        <Segmented
          label="Layout"
          options={LAYOUT_OPTIONS}
          value={session.surface.layout}
          onChange={(l) => inst.setLayout(l)}
        />
      </div>
    </div>
  )
}
