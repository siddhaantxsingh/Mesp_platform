import { describe, expect, it, vi } from 'vitest'
import { LiveClient } from './client'
import { freshness, type DeviceLive } from './store'

class FakeWS {
  static last: FakeWS
  sent: string[] = []
  onopen?: () => void; onmessage?: (e: { data: string }) => void; onclose?: (e: { code: number }) => void; onerror?: () => void
  constructor(public url: string) { FakeWS.last = this }
  send(s: string) { this.sent.push(s) }
  close(code = 1000) { this.onclose?.({ code }) }
  recv(o: unknown) { this.onmessage?.({ data: JSON.stringify(o) }) }
}
const opts = (states: string[]) => ({ url: 'ws://x', getToken: () => 'tok', onMessage: () => {}, onState: (s: string) => states.push(s), WebSocketImpl: FakeWS as unknown as typeof WebSocket })

describe('LiveClient', () => {
  it('authenticates first, subscribes after hello, answers pings', () => {
    const states: string[] = []
    const c = new LiveClient(opts(states))
    c.subscribe('dev1')
    c.connect()
    const ws = FakeWS.last
    ws.onopen!()
    expect(JSON.parse(ws.sent[0])).toEqual({ type: 'auth', token: 'tok' })
    ws.recv({ v: 1, type: 'hello' })
    expect(JSON.parse(ws.sent[1])).toEqual({ type: 'subscribe', device_id: 'dev1' })
    ws.recv({ v: 1, type: 'ping' })
    expect(JSON.parse(ws.sent[2])).toEqual({ type: 'pong' })
    expect(states).toEqual(['connecting', 'authenticating', 'open'])
    c.close()
  })
  it('reconnects with backoff, but not after an auth rejection', () => {
    vi.useFakeTimers()
    const states: string[] = []
    const c = new LiveClient(opts(states))
    c.connect()
    const first = FakeWS.last
    first.close(1006)
    expect(states.at(-1)).toBe('reconnecting')
    vi.advanceTimersByTime(1000)
    expect(FakeWS.last).not.toBe(first)
    FakeWS.last.close(4401)
    expect(states.at(-1)).toBe('auth_failed')
    c.close()
    vi.useRealTimers()
  })
})

describe('freshness', () => {
  const d = (o: Partial<DeviceLive>): DeviceLive => ({ status: null, vitals: null, link: 'streaming', linkReason: '', lastSampleWall: 1000, synthetic: false, sessionId: 's', events: [], ...o })
  it('maps states', () => {
    expect(freshness('open', d({}), true, 1500)).toBe('LIVE')
    expect(freshness('open', d({}), true, 5000)).toBe('STALE')
    expect(freshness('open', d({}), true, 20000)).toBe('DISCONNECTED')
    expect(freshness('open', d({ link: 'disconnected' }), true, 1100)).toBe('DISCONNECTED')
    expect(freshness('open', undefined, false)).toBe('NO DATA')
    expect(freshness('connecting', undefined, true)).toBe('LOADING')
    expect(freshness('auth_failed', d({}), true)).toBe('ERROR')
  })
})
