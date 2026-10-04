import { create } from 'zustand'
import type { LinkState, LinkStats, LiveMessage, LiveStatus, MespEvent, Vitals } from '@mesp/types'
import { LiveClient, type ConnState } from './client'
import { TimeRing } from './ring'
import { useAuth } from '../auth'

export interface StreamBuffers {
  ecg: TimeRing        // filtered ECG (display band), 1 channel
  pleth: TimeRing      // band-passed IR pleth, 1 channel
  ppgRaw: TimeRing     // red, ir raw codes
  accel: TimeRing      // ax, ay, az, |a|
  gyro: TimeRing       // gx, gy, gz
}

const WINDOW_S = 60
const buffers = new Map<string, StreamBuffers>()

export function getBuffers(deviceId: string): StreamBuffers {
  let b = buffers.get(deviceId)
  if (!b) {
    b = {
      ecg: new TimeRing(250 * WINDOW_S, 1),
      pleth: new TimeRing(100 * WINDOW_S, 1),
      ppgRaw: new TimeRing(100 * WINDOW_S, 2),
      accel: new TimeRing(100 * WINDOW_S, 4),
      gyro: new TimeRing(100 * WINDOW_S, 3),
    }
    buffers.set(deviceId, b)
  }
  return b
}

export interface DeviceLive {
  status: LiveStatus | null
  vitals: (Vitals & { link?: { loss_ratio: number | null; crc_ratio: number | null }; stats?: LinkStats }) | null
  link: LinkState | null
  linkReason: string
  lastSampleWall: number | null
  synthetic: boolean
  sessionId: string | null
  events: MespEvent[]
}

interface LiveState {
  conn: ConnState
  connDetail?: string
  devices: Record<string, DeviceLive>
  newCritical: MespEvent | null
  start: () => void
  stop: () => void
  watch: (deviceId: string) => void
  unwatch: (deviceId: string) => void
  ingest: (m: LiveMessage) => void
  markAck: (e: MespEvent) => void
}

const empty = (): DeviceLive => ({ status: null, vitals: null, link: null, linkReason: '', lastSampleWall: null, synthetic: false, sessionId: null, events: [] })

let client: LiveClient | null = null

export const useLive = create<LiveState>((set, get) => ({
  conn: 'idle',
  devices: {},
  newCritical: null,
  start: () => {
    if (client) return
    client = new LiveClient({
      getToken: () => useAuth.getState().token,
      onMessage: (m) => get().ingest(m),
      onState: (conn, connDetail) => set({ conn, connDetail }),
    })
    client.connect()
  },
  stop: () => { client?.close(); client = null; set({ conn: 'idle' }) },
  watch: (id) => { get().start(); client?.subscribe(id) },
  unwatch: (id) => client?.unsubscribe(id),
  markAck: (e) => set((s) => {
    const d = s.devices[e.device_id]
    if (!d) return s
    return { devices: { ...s.devices, [e.device_id]: { ...d, events: d.events.map((x) => (x.id === e.id ? e : x)) } } }
  }),
  ingest: (m) => {
    if (m.type === 'hello' || m.type === 'ping') return
    const id = m.device_id
    const upd = (f: (d: DeviceLive) => Partial<DeviceLive>) =>
      set((s) => ({ devices: { ...s.devices, [id]: { ...(s.devices[id] ?? empty()), ...f(s.devices[id] ?? empty()) } } }))
    switch (m.type) {
      case 'samples': {
        const b = getBuffers(id)
        if (m.stream === 'ecg') b.ecg.push(m.t0, m.fs, [m.values], m.gap)
        else if (m.stream === 'ppg') {
          b.pleth.push(m.t0, m.fs, [m.pleth], m.gap)
          b.ppgRaw.push(m.t0, m.fs, [m.red, m.ir], m.gap)
        } else {
          const ax = m.accel.map((r) => r[0]), ay = m.accel.map((r) => r[1]), az = m.accel.map((r) => r[2])
          b.accel.push(m.t0, m.fs, [ax, ay, az, m.mag], m.gap)
          b.gyro.push(m.t0, m.fs, [m.gyro.map((r) => r[0]), m.gyro.map((r) => r[1]), m.gyro.map((r) => r[2])], m.gap)
        }
        // throttle React updates: only bump when the freshness second changes
        const now = Date.now()
        const prev = get().devices[id]?.lastSampleWall ?? 0
        if (now - prev > 500) upd(() => ({ lastSampleWall: now }))
        return
      }
      case 'vitals': {
        const { type: _t, v: _v, device_id: _d, ...rest } = m
        upd(() => ({ vitals: rest as DeviceLive['vitals'], synthetic: m.synthetic, sessionId: m.session_id }))
        return
      }
      case 'event':
        upd((d) => ({ events: [m.event, ...d.events.filter((e) => e.id !== m.event.id)].slice(0, 100) }))
        if (m.event.severity === 'CRITICAL') set({ newCritical: m.event })
        return
      case 'event_ack':
        get().markAck(m.event)
        return
      case 'link':
        upd(() => ({ link: m.state, linkReason: m.reason }))
        return
      case 'subscribed':
        if (m.status) upd(() => ({ status: m.status, link: m.status!.link_state, synthetic: m.status!.synthetic, sessionId: m.status!.session_id, vitals: m.status!.vitals as DeviceLive['vitals'] }))
        return
      case 'session':
        if (m.state === 'started') {
          const b = getBuffers(id)
          Object.values(b).forEach((r) => r.clear())
          upd(() => ({ sessionId: m.session_id, synthetic: !!m.synthetic, link: 'connecting', vitals: null }))
        } else upd(() => ({ link: 'disconnected' }))
        return
    }
  },
}))

export type Freshness = 'LIVE' | 'STALE' | 'DISCONNECTED' | 'LOADING' | 'ERROR' | 'NO DATA'

export function freshness(conn: ConnState, d: DeviceLive | undefined, everSeen: boolean, now = Date.now()): Freshness {
  if (conn === 'auth_failed') return 'ERROR'
  if (conn === 'connecting' || conn === 'authenticating' || conn === 'idle') return 'LOADING'
  if (conn === 'reconnecting') return d?.lastSampleWall ? 'STALE' : 'LOADING'
  if (!d || (!d.lastSampleWall && !d.link)) return everSeen ? 'DISCONNECTED' : 'NO DATA'
  if (d.link === 'disconnected') return 'DISCONNECTED'
  if (d.link === 'stale') return 'STALE'
  if (!d.lastSampleWall) return 'LOADING'
  const age = now - d.lastSampleWall
  if (age > 10_000) return 'DISCONNECTED'
  if (age > 2_500) return 'STALE'
  return 'LIVE'
}
