/*
 * TransportBar — the always-visible top strip. Wordmark, musical key + scale,
 * tempo (with tap + Link mirroring), Link status, MIDI routing and the surface
 * layout switch. Everything here reads `session.*` / transient hook fields and
 * calls the store actions; it never owns state.
 */
import { Segmented, Select, Slider, Toggle } from './ui'
import type { SegmentedOption, SelectOption } from './ui'
import { TuningControls } from './TuningControls'
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
  // A microtuning replaces the pitch palette outright, so the diatonic mode is
  // bypassed (see harmony/tuning.ts). Disable Scale to make that legible.
  const tuned = session.tuning != null

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
      <div className="transport__brand">
        <h1 className="transport__wordmark">
          <img src={`${import.meta.env.BASE_URL}mkeys-wordmark.svg`} alt="mkeys" width={120} height={40} />
        </h1>
        {/* Build version, so what's actually running is visible at a glance. */}
        <span className="transport__version">v{__APP_VERSION__}</span>
      </div>

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

      {/* tempo — slider with Tap/Link inline (bottom-aligned to the track) so the
          block is the same height as Master/Gain instead of dangling a 2nd row */}
      <div className="transport__block">
        <div className="transport__row transport__tempo">
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
          {/* Always-visible emergency stop (§13): silences every synth voice,
              MIDI-out note, MPE/pitch-bend + sustain state, and STOPS the
              arpeggiator and phrase playback. Reachable in normal and focus
              modes (the transport strip is always shown). Shortcut: Esc. */}
          <button
            type="button"
            className="pbtn pbtn--panic"
            onClick={() => inst.panic()}
            title="Panic — all notes off. Silences every voice and MIDI note and stops the arp + phrase. Shortcut: Esc"
            aria-keyshortcuts="Escape"
          >
            Panic
          </button>
        </div>
      </div>

      {/* Routing — everything that moves signal in or out: MIDI and the mbus */}
      <div className="transport__block">
        <span className="eyebrow">Routing</span>
        <div className="transport__row">
          {inst.midiReady ? (
            <>
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
                disabled={!session.midi.outEnabled || session.midi.mpe}
                onChange={(v) => inst.setMidiConfig({ ...session.midi, outChannel: Number(v) })}
              />
              <Toggle
                label="MPE"
                hint="microtonal out (±48 st)"
                checked={session.midi.mpe}
                disabled={!session.midi.outEnabled}
                onChange={(v) => inst.setMidiConfig({ ...session.midi, mpe: v })}
              />
            </>
          ) : (
            <button type="button" className="pbtn" onClick={() => void inst.enableMidi()}>
              Enable MIDI
            </button>
          )}
          <span
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
          </span>
        </div>
      </div>

      {/* layout — pinned to the right edge to bookend the engine row */}
      <div className="transport__block transport__block--end">
        <Segmented
          label="Layout"
          options={LAYOUT_OPTIONS}
          value={session.surface.layout}
          onChange={(l) => inst.setLayout(l)}
        />
      </div>

      {/* Pitch strip — Key · Scale · Tuning as one musical row, directly above
          the surface it configures. The break forces the wrap here so the strip
          never splinters mid-group. */}
      <div className="transport__break" aria-hidden="true" />
      <div className="transport__block keystrip">
        <Segmented
          label="Key"
          options={KEY_OPTIONS}
          value={String(session.keyRoot)}
          onChange={(v) => inst.setKeyRoot(Number(v) as PitchClass)}
        />
      </div>
      <div
        className="transport__block"
        title={
          tuned
            ? 'Scale is set by the active tuning — the microtuning replaces the diatonic mode. Switch Tuning to 12-TET to use scales.'
            : undefined
        }
      >
        <Select
          label="Scale"
          options={MODE_OPTIONS}
          value={session.mode}
          disabled={tuned}
          onChange={(m) => inst.setMode(m)}
        />
      </div>
      {/* tuning — the third "which pitches" control; overrides Scale when active */}
      <TuningControls />

      {/* register — which octave the bottom-left pad starts at */}
      <div className="transport__block">
        <span className="eyebrow">Octave</span>
        <div className="transport__row">
          <button
            type="button"
            className="pbtn"
            aria-label="Octave down"
            disabled={session.surface.baseOctave <= -1}
            onClick={() => inst.setBaseOctave(session.surface.baseOctave - 1)}
          >
            −
          </button>
          <span className="transport__octave">{session.surface.baseOctave}</span>
          <button
            type="button"
            className="pbtn"
            aria-label="Octave up"
            disabled={session.surface.baseOctave >= 9}
            onClick={() => inst.setBaseOctave(session.surface.baseOctave + 1)}
          >
            +
          </button>
        </div>
      </div>
    </div>
  )
}
