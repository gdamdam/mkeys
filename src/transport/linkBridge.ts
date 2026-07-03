/**
 * linkBridge — WebSocket client for the mpump Link Bridge companion app.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Derivation / attribution
 * ------------------------
 * This file is adapted (near-verbatim) from the mchord project's
 * `src/transport/linkBridge.ts`, which is itself lifted from mdrone
 * (`src/engine/linkBridge.ts`) and originally mpump
 * (`server/src/utils/linkBridge.ts`). The same companion app, WebSocket
 * server (ws://localhost:19876) and message protocol serve mpump, mdrone,
 * mchord and mkeys. Original sources are AGPL-3.0; see
 * github.com/gdamdam/mpump and github.com/gdamdam/mdrone. Changes here are
 * limited to mkeys naming; the protocol and connection strategy are unchanged.
 *
 * Browsers can't speak Ableton Link directly (no UDP / multicast), so this
 * bridge is the only practical way to sync tempo with Ableton Live, Logic,
 * Bitwig, etc. No internet connections are made — all traffic stays on
 * localhost.
 */

export interface LinkState {
  tempo: number // BPM from the Link session
  beat: number // current beat position
  phase: number // phase within a bar (0..3.999 for 4/4)
  playing: boolean // whether the Link session is playing
  peers: number // other Link peers (Ableton Live, Bitwig, …)
  clients: number // browser clients connected to the bridge
  connected: boolean // whether we're connected to the bridge
}

type LinkListener = (state: LinkState) => void

/** Keep a numeric field from an untrusted bridge message only if it's a
 *  finite number, clamped to [min, max]; otherwise fall back to prev. */
function clampFinite(value: unknown, prev: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : prev
}

/** Build the next LinkState from an untrusted "link" message + the previous
 *  state. The bridge WebSocket is loopback-only, so this is defense-in-depth.
 *  Exported for unit testing. */
export function sanitizeLinkMessage(
  msg: Record<string, unknown>,
  prev: LinkState,
): LinkState {
  return {
    tempo: clampFinite(msg.tempo, prev.tempo, 20, 999),
    beat: clampFinite(msg.beat, prev.beat, 0, 1e9),
    phase: clampFinite(msg.phase, prev.phase, 0, 16),
    playing: typeof msg.playing === 'boolean' ? msg.playing : prev.playing,
    peers: Math.floor(clampFinite(msg.peers, prev.peers, 0, 9999)),
    clients: Math.floor(clampFinite(msg.clients, prev.clients, 0, 9999)),
    connected: true,
  }
}

const WS_URLS = ['ws://127.0.0.1:19876', 'ws://[::1]:19876', 'ws://localhost:19876']
const RETRY_MS = 5000
let wsUrlIdx = 0

let ws: WebSocket | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let listeners: LinkListener[] = []
let lastState: LinkState = {
  tempo: 120,
  beat: 0,
  phase: 0,
  playing: false,
  peers: 0,
  clients: 0,
  connected: false,
}
let enabled = false
let autoMode = false

function notify(): void {
  for (const fn of listeners) fn(lastState)
}

function connect(): void {
  if (ws) return
  // Guard for non-DOM environments (tests / SSR): no WebSocket → no-op.
  if (typeof WebSocket === 'undefined') return
  try {
    ws = new WebSocket(WS_URLS[wsUrlIdx])

    ws.onopen = () => {
      enabled = true
      lastState = { ...lastState, connected: true }
      notify()
    }

    ws.onmessage = (e: MessageEvent) => {
      try {
        const msg: unknown = JSON.parse(typeof e.data === 'string' ? e.data : '')
        if (
          typeof msg === 'object' &&
          msg !== null &&
          (msg as { type?: unknown }).type === 'link'
        ) {
          lastState = sanitizeLinkMessage(msg as Record<string, unknown>, lastState)
          notify()
        }
      } catch {
        /* ignore malformed JSON */
      }
    }

    ws.onclose = () => {
      ws = null
      if (lastState.connected) {
        lastState = { ...lastState, connected: false, peers: 0 }
        notify()
      }
      if (enabled && !autoMode) scheduleRetry()
    }

    ws.onerror = () => {
      wsUrlIdx = (wsUrlIdx + 1) % WS_URLS.length
      ws?.close()
    }
  } catch {
    wsUrlIdx = (wsUrlIdx + 1) % WS_URLS.length
    if (enabled && !autoMode) scheduleRetry()
  }
}

function scheduleRetry(): void {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = setTimeout(connect, RETRY_MS)
}

/** Enable a persistent bridge connection (retries every {@link RETRY_MS}). */
export function enableLinkBridge(on: boolean): void {
  enabled = on
  autoMode = false
  if (on) {
    connect()
  } else {
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    if (ws) {
      ws.close()
      ws = null
    }
    lastState = { ...lastState, connected: false, peers: 0 }
    notify()
  }
}

/** Subscribe to Link state; returns an unsubscribe function. */
export function onLinkState(fn: LinkListener): () => void {
  listeners.push(fn)
  return () => {
    listeners = listeners.filter((l) => l !== fn)
  }
}

/** Advertise our tempo to the bridge (ignored when disconnected). */
export function sendLinkTempo(tempo: number): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'set_tempo', tempo }))
  }
}

/** Advertise a transport play/stop to the bridge (ignored when disconnected). */
export function sendLinkPlaying(playing: boolean): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'set_playing', playing }))
  }
}

/** The most recent Link state (synchronous read). */
export function getLinkState(): LinkState {
  return lastState
}

/**
 * Auto-detect: try connecting once on page load. If the bridge is running,
 * stays connected. If not, silently gives up. Does not retry — use
 * {@link enableLinkBridge}(true) for a persistent connection.
 */
export function autoDetectLinkBridge(): void {
  if (enabled || ws) return
  autoMode = true
  connect()
}
