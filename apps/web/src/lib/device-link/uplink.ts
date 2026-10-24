/**
 * The website's own "gateway": bytes from Bluetooth or the USB cable -> frames -> MESP API.
 *
 *   ByteSource (BLE notifications | USB serial)
 *     -> Deframer (@mesp/protocol, same resync/CRC rules as the Python gateway)
 *     -> batches every 100 ms, ingest message v1 (identical to services/gateway)
 *     -> WebSocket /api/v1/ingest/browser/ws (authenticated with the signed-in user's token)
 *
 * Frames are forwarded unmodified (re-encoding a decoded frame reproduces its bytes, CRC included);
 * the API re-checks every CRC and does all decoding, exactly as for the command-line gateway.
 *
 * Failure handling
 *   - Bluetooth drops: the API is told the link is down (it raises a "device disconnected" event),
 *     and the page keeps trying to reconnect to the same band every 3 s.
 *   - USB cable pulled: reported, streaming stops (plug it back in and press Connect again).
 *   - Internet/API drops: frames are kept (up to ~60 s) and sent after the WebSocket reconnects.
 *   - Refusals (not allowed, unknown device, already streaming elsewhere) stop with a clear message.
 */
import { Deframer, encodeFrame } from '@mesp/protocol'
import type { ByteSource } from './sources'

export type LinkPhase = 'connecting' | 'streaming' | 'reconnecting' | 'stopped' | 'error'

export interface LinkSnapshot {
  phase: LinkPhase
  message: string
  kind: ByteSource['kind']
  label: string
  deviceId: string
  sessionId: string | null
  bytes: number
  frames: number
  crcErrors: number
  queued: number
  bytesPerSec: number
  lastDataAt: number | null
}

export interface DeviceLinkOptions {
  source: ByteSource
  deviceId: string
  getToken: () => string | null
  url: string
  onChange: (s: LinkSnapshot) => void
  WebSocketImpl?: typeof WebSocket
  /** for tests */
  batchMs?: number
  bleRetryMs?: number
  now?: () => number
}

const INGEST_VERSION = 1
const MAX_QUEUE = 60_000          // frames (~60 s of the full sensor stream)
const MAX_BATCH = 4096            // API limit per message

/** Ingest message v1: u8 version | u16 count (LE) | count x { f64 rx_time (LE) | u16 n (LE) | n bytes }. */
export function encodeBatch(items: [number, Uint8Array][]): Uint8Array {
  if (items.length > MAX_BATCH) throw new RangeError('batch too large')
  const size = 3 + items.reduce((n, [, b]) => n + 10 + b.length, 0)
  const out = new Uint8Array(size)
  const v = new DataView(out.buffer)
  v.setUint8(0, INGEST_VERSION)
  v.setUint16(1, items.length, true)
  let o = 3
  for (const [t, b] of items) {
    v.setFloat64(o, t, true)
    v.setUint16(o + 8, b.length, true)
    out.set(b, o + 10)
    o += 10 + b.length
  }
  return out
}

const FATAL: Record<number, string> = {
  4401: 'Your sign-in has expired. Sign in again, then reconnect.',
  4403: 'Streaming a device needs a signed-in account with operator rights (the demo login cannot stream real devices).',
  4404: 'This device no longer exists on the server. Choose or add a device first.',
  4409: 'This device is already streaming from somewhere else (another browser tab, computer, or the gateway program).',
}

export class DeviceLink {
  private ws: WebSocket | null = null
  private deframer = new Deframer()
  private queue: [number, Uint8Array][] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private statusTimer: ReturnType<typeof setInterval> | null = null
  private retry: ReturnType<typeof setTimeout> | null = null
  private wsAttempt = 0
  private crcBase = 0
  private sessionReady = false
  private linkUp = false
  private userStopped = false
  private rate: [number, number][] = []
  snap: LinkSnapshot

  constructor(private o: DeviceLinkOptions) {
    this.snap = {
      phase: 'connecting', message: 'Connecting to the server…', kind: o.source.kind, label: o.source.label,
      deviceId: o.deviceId, sessionId: null, bytes: 0, frames: 0, crcErrors: 0, queued: 0, bytesPerSec: 0, lastDataAt: null,
    }
  }

  private now() { return (this.o.now ?? Date.now)() }

  private emit(patch: Partial<LinkSnapshot> = {}) {
    const t = this.now()
    this.rate = this.rate.filter(([ts]) => t - ts < 3000)
    const bytes = this.rate.reduce((n, [, b]) => n + b, 0)
    this.snap = {
      ...this.snap, ...patch, bytes: this.deframer.stats.bytesIn, frames: this.deframer.stats.framesOk,
      crcErrors: this.deframer.stats.crcErrors, queued: this.queue.length, bytesPerSec: Math.round(bytes / 3),
    }
    this.o.onChange(this.snap)
  }

  /** Open the server connection, then the device. Resolves once streaming has started (or throws). */
  async start(): Promise<void> {
    await this.openSocket()
    try {
      await this.o.source.start({ onBytes: (c, t) => this.onBytes(c, t), onLost: (r) => void this.onLost(r) })
    } catch (e) {
      this.fail(`Could not open the device: ${(e as Error).message}`)
      throw e
    }
    this.label()
    this.sendLink('connecting', `browser ${this.o.source.kind}`)
    this.sendLink('connected', `${this.o.source.kind === 'bluetooth' ? 'Bluetooth' : 'USB cable'} ${this.o.source.label}`)
    this.linkUp = true
    this.emit({ phase: 'streaming', message: 'Connected. Waiting for data from the band…' })
    this.timer = setInterval(() => this.flush(), this.o.batchMs ?? 100)
    this.statusTimer = setInterval(() => this.sendStatus(), 2000)
  }

  private label() { this.snap.label = this.o.source.label }

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const token = this.o.getToken()
      if (!token) { this.fail(FATAL[4401]); reject(new Error(FATAL[4401])); return }
      const WS = this.o.WebSocketImpl ?? WebSocket
      const ws = new WS(this.o.url)
      ws.binaryType = 'arraybuffer'
      this.ws = ws
      this.sessionReady = false
      let settled = false
      ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token, device_id: this.o.deviceId }))
      ws.onmessage = (ev) => {
        let m: { type?: string; session_id?: string }
        try { m = JSON.parse(String(ev.data)) } catch { return }
        if (m.type === 'authenticated') {
          ws.send(JSON.stringify({ type: 'hello', source: `browser:${this.o.source.kind} ${this.o.source.label}`, synthetic: false, realtime: true, ingest_version: 1 }))
        } else if (m.type === 'welcome') {
          this.sessionReady = true
          this.wsAttempt = 0
          this.crcBase = this.deframer.stats.crcErrors
          this.snap.sessionId = m.session_id ?? null
          if (this.linkUp) { this.sendLink('connecting', 'server reconnected'); this.sendLink('connected', 'server reconnected') }
          if (!settled) { settled = true; resolve() }
          this.emit(this.linkUp ? { phase: 'streaming', message: 'Streaming' } : {})
        }
      }
      ws.onclose = (ev) => {
        if (this.ws !== ws) return
        this.ws = null
        this.sessionReady = false
        if (this.userStopped) return
        if (FATAL[ev.code]) {
          this.fail(FATAL[ev.code])
          void this.o.source.stop()
          if (!settled) { settled = true; reject(new Error(FATAL[ev.code])) }
          return
        }
        if (!settled) { settled = true; this.fail('Cannot reach the MESP server. Check the internet connection and that the API is running.'); reject(new Error('server unreachable')); return }
        // keep the device open, buffer frames, reconnect with backoff
        const delay = Math.min(10_000, 1000 * 2 ** this.wsAttempt++)
        this.emit({ phase: 'reconnecting', message: `Server connection lost. Retrying in ${Math.round(delay / 1000)} s (data is kept meanwhile)…` })
        this.retry = setTimeout(() => { this.openSocket().catch(() => { /* handled in onclose */ }) }, delay)
      }
      ws.onerror = () => { /* onclose follows */ }
    })
  }

  private onBytes(chunk: Uint8Array, rxTime: number) {
    this.rate.push([this.now(), chunk.length])
    for (const f of this.deframer.feed(chunk)) {
      if (this.queue.length >= MAX_QUEUE) this.queue.shift()
      this.queue.push([rxTime, encodeFrame(f.type, f.seq, f.payload, f.version)])
    }
    if (this.snap.message.startsWith('Connected. Waiting') && this.deframer.stats.framesOk > 0) this.snap.message = 'Streaming'
    this.snap.lastDataAt = this.now()
  }

  private flush() {
    if (this.ws && this.sessionReady && this.ws.readyState === 1) {
      while (this.queue.length) {
        const batch = this.queue.splice(0, MAX_BATCH)
        this.ws.send(encodeBatch(batch))
      }
    }
    this.emit()
  }

  private sendStatus() {
    if (!this.ws || !this.sessionReady) return
    const s = this.deframer.stats
    this.ws.send(JSON.stringify({
      type: 'status', source: `browser:${this.o.source.kind}`, link_state: this.linkUp ? 'streaming' : 'disconnected',
      deframer: { bytes_in: s.bytesIn, frames_ok: s.framesOk, crc_errors: s.crcErrors - this.crcBase, length_errors: s.lengthErrors,
                  unsupported: s.unsupported, bytes_discarded: s.bytesDiscarded },
      frames_forwarded: s.framesOk,
    }))
  }

  private sendLink(to: string, reason: string) {
    const from = { connecting: 'disconnected', connected: 'connecting', streaming: 'connected', disconnected: 'streaming' }[to] ?? ''
    if (this.ws && this.sessionReady) this.ws.send(JSON.stringify({ type: 'link', from, to, reason }))
  }

  private async onLost(reason: string) {
    if (this.userStopped) return
    this.flush()
    this.linkUp = false
    this.sendLink('disconnected', reason)
    if (this.o.source.kind === 'bluetooth') {
      this.emit({ phase: 'reconnecting', message: `${reason}. Trying to reconnect…` })
      const tryAgain = async () => {
        if (this.userStopped) return
        try {
          await this.o.source.start({ onBytes: (c, t) => this.onBytes(c, t), onLost: (r) => void this.onLost(r) })
          this.linkUp = true
          this.sendLink('connecting', 'Bluetooth reconnect')
          this.sendLink('connected', 'Bluetooth reconnected')
          this.emit({ phase: 'streaming', message: 'Reconnected' })
        } catch {
          this.retry = setTimeout(tryAgain, this.o.bleRetryMs ?? 3000)
        }
      }
      this.retry = setTimeout(tryAgain, this.o.bleRetryMs ?? 3000)
      return
    }
    // USB: the port is gone until it is plugged in and chosen again
    this.cleanupTimers()
    this.ws?.close(1000, 'device lost')     // no "bye": the server records an unexpected disconnect
    this.ws = null
    this.emit({ phase: 'stopped', message: `${reason}. Plug it back in and press Connect again.` })
  }

  private fail(message: string) {
    this.cleanupTimers()
    this.emit({ phase: 'error', message })
  }

  private cleanupTimers() {
    if (this.timer) clearInterval(this.timer)
    if (this.statusTimer) clearInterval(this.statusTimer)
    if (this.retry) clearTimeout(this.retry)
    this.timer = this.statusTimer = this.retry = null
  }

  /** User pressed Disconnect: send what is left, tell the server it was deliberate, close everything. */
  async stop(): Promise<void> {
    this.userStopped = true
    this.cleanupTimers()
    await this.o.source.stop()
    const ws = this.ws
    if (ws && this.sessionReady && ws.readyState === 1) {
      while (this.queue.length) ws.send(encodeBatch(this.queue.splice(0, MAX_BATCH)))
      this.sendStatus()
      ws.send(JSON.stringify({ type: 'bye' }))   // deliberate stop: the server closes the session without a disconnect alarm
      ws.close(1000, 'bye')
    } else {
      ws?.close()
    }
    this.ws = null
    this.emit({ phase: 'stopped', message: 'Disconnected' })
  }
}
