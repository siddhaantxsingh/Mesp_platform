/**
 * Live WebSocket client (protocol v1). State machine:
 *   idle -> connecting -> authenticating -> open -> (reconnecting -> connecting ...) | closed
 * Exponential backoff with jitter, heartbeat (server ping -> client pong), silence watchdog.
 */
import type { LiveMessage } from '@mesp/types'
import { liveWsUrl } from '../config'

export type ConnState = 'idle' | 'connecting' | 'authenticating' | 'open' | 'reconnecting' | 'closed' | 'auth_failed'

export interface LiveClientOptions {
  url?: string
  getToken: () => string | null
  onMessage: (m: LiveMessage) => void
  onState: (s: ConnState, detail?: string) => void
  WebSocketImpl?: typeof WebSocket
}

export class LiveClient {
  private ws: WebSocket | null = null
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private watchdog: ReturnType<typeof setInterval> | null = null
  private lastMsg = 0
  private subs = new Set<string>()
  state: ConnState = 'idle'

  constructor(private o: LiveClientOptions) {}

  private set(s: ConnState, detail?: string) {
    this.state = s
    this.o.onState(s, detail)
  }

  private url() {
    return this.o.url ?? liveWsUrl()
  }

  connect() {
    if (this.ws && (this.state === 'open' || this.state === 'connecting' || this.state === 'authenticating')) return
    const token = this.o.getToken()
    if (!token) { this.set('auth_failed', 'not signed in'); return }
    this.set('connecting')
    const WS = this.o.WebSocketImpl ?? WebSocket
    const ws = new WS(this.url())
    this.ws = ws
    ws.onopen = () => {
      this.set('authenticating')
      ws.send(JSON.stringify({ type: 'auth', token }))
    }
    ws.onmessage = (ev) => {
      this.lastMsg = Date.now()
      let m: LiveMessage
      try { m = JSON.parse(ev.data as string) } catch { return }
      if (m.type === 'hello') {
        this.attempt = 0
        this.set('open')
        for (const d of this.subs) ws.send(JSON.stringify({ type: 'subscribe', device_id: d }))
      } else if (m.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }))
      }
      this.o.onMessage(m)
    }
    ws.onclose = (ev) => {
      this.ws = null
      if (this.state === 'closed') return
      if (ev.code === 4401) { this.set('auth_failed', 'session expired'); return }
      this.schedule()
    }
    ws.onerror = () => { /* onclose follows */ }
    if (!this.watchdog) {
      this.watchdog = setInterval(() => {
        if (this.state === 'open' && Date.now() - this.lastMsg > 40_000) this.ws?.close(4000, 'silent')
      }, 5000)
    }
  }

  private schedule() {
    const ceiling = Math.min(15_000, 500 * 2 ** this.attempt++)
    const delay = ceiling / 2 + Math.random() * (ceiling / 2)
    this.set('reconnecting', `retry in ${(delay / 1000).toFixed(1)} s`)
    this.timer = setTimeout(() => this.connect(), delay)
  }

  subscribe(deviceId: string) {
    if (this.subs.has(deviceId)) return
    this.subs.add(deviceId)
    if (this.state === 'open') this.ws?.send(JSON.stringify({ type: 'subscribe', device_id: deviceId }))
  }

  unsubscribe(deviceId: string) {
    if (!this.subs.delete(deviceId)) return
    if (this.state === 'open') this.ws?.send(JSON.stringify({ type: 'unsubscribe', device_id: deviceId }))
  }

  close() {
    this.set('closed')
    if (this.timer) clearTimeout(this.timer)
    if (this.watchdog) clearInterval(this.watchdog)
    this.watchdog = null
    this.ws?.close(1000, 'bye')
    this.ws = null
  }
}
