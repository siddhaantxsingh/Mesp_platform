// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ByteSource, SourceCallbacks } from './sources'
import { linkSupport } from './sources'
import { DeviceLink, encodeBatch, type LinkSnapshot } from './uplink'

const vec = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../../packages/protocol/vectors/firmware_vectors.json', import.meta.url)), 'utf8'))
const V: Record<string, Uint8Array> = Object.fromEntries(
  vec.vectors.map((v: { name: string; hex: string }) => [v.name, Uint8Array.from(v.hex.match(/../g)!.map((h: string) => parseInt(h, 16)))]),
)

class FakeWS {
  static last: FakeWS[] = []
  readyState = 0
  binaryType = ''
  sent: (string | Uint8Array)[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) { FakeWS.last.push(this); setTimeout(() => { this.readyState = 1; this.onopen?.() }, 0) }
  send(d: string | Uint8Array) { this.sent.push(d) }
  close() { this.readyState = 3 }
  server(m: object) { this.onmessage?.({ data: JSON.stringify(m) }) }
  drop(code = 1006) { this.readyState = 3; this.onclose?.({ code }) }
  json() { return this.sent.filter((x): x is string => typeof x === 'string').map((x) => JSON.parse(x)) }
  binary() { return this.sent.filter((x): x is Uint8Array => typeof x !== 'string') }
}

class FakeSource implements ByteSource {
  kind: 'bluetooth' | 'usb'
  label = 'MESP-Health'
  cb: SourceCallbacks | null = null
  starts = 0
  failNext = false
  stopped = false
  constructor(kind: 'bluetooth' | 'usb' = 'bluetooth') { this.kind = kind }
  async start(cb: SourceCallbacks) { this.starts++; if (this.failNext) { this.failNext = false; throw new Error('not yet') } this.cb = cb }
  async stop() { this.stopped = true }
}

/** Splits ingest message v1 back into frames. */
function decodeBatch(b: Uint8Array): [number, Uint8Array][] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const n = v.getUint16(1, true)
  const out: [number, Uint8Array][] = []
  let o = 3
  for (let i = 0; i < n; i++) {
    const t = v.getFloat64(o, true), len = v.getUint16(o + 8, true)
    out.push([t, b.slice(o + 10, o + 10 + len)])
    o += 10 + len
  }
  return out
}

async function started(src: FakeSource, snaps: LinkSnapshot[] = []) {
  const link = new DeviceLink({ source: src, deviceId: 'dev1', getToken: () => 'tok', url: 'ws://x/api/v1/ingest/browser/ws',
    onChange: (s) => snaps.push(s), WebSocketImpl: FakeWS as unknown as typeof WebSocket, batchMs: 10, bleRetryMs: 20 })
  const p = link.start()
  await vi.advanceTimersByTimeAsync(1)
  const ws = FakeWS.last.at(-1)!
  expect(ws.json()[0]).toEqual({ type: 'auth', token: 'tok', device_id: 'dev1' })
  ws.server({ type: 'authenticated', device_id: 'dev1' })
  expect(ws.json()[1]).toMatchObject({ type: 'hello', source: 'browser:bluetooth MESP-Health'.replace('bluetooth', src.kind) })
  ws.server({ type: 'welcome', session_id: 's1' })
  await p
  return { link, ws }
}

beforeEach(() => { vi.useFakeTimers(); FakeWS.last = [] })
afterEach(() => vi.useRealTimers())

describe('encodeBatch', () => {
  it('matches the gateway ingest format (u8 ver, u16 count, f64 time, u16 len, bytes)', () => {
    const b = encodeBatch([[1.5, Uint8Array.of(0xaa, 0x55)]])
    expect(Array.from(b)).toEqual([1, 1, 0, 0, 0, 0, 0, 0, 0, 0xf8, 0x3f, 2, 0, 0xaa, 0x55])
  })
})

describe('DeviceLink', () => {
  it('forwards firmware frames byte-for-byte, split across arbitrary chunks, and reports link changes', async () => {
    const src = new FakeSource()
    const { ws } = await started(src)
    expect(ws.json().filter((m) => m.type === 'link').map((m) => m.to)).toEqual(['connecting', 'connected'])
    const stream = new Uint8Array([...V.ppg_4, 0x13, 0x37, ...V.ecg_6, ...V.event_fall])  // junk between frames
    for (let i = 0; i < stream.length; i += 7) src.cb!.onBytes(stream.subarray(i, i + 7), 1000 + i)
    await vi.advanceTimersByTimeAsync(20)
    const frames = ws.binary().flatMap(decodeBatch).map(([, f]) => f)
    expect(frames).toEqual([V.ppg_4, V.ecg_6, V.event_fall])
  })

  it('Bluetooth drop: tells the server, retries, and resumes', async () => {
    const src = new FakeSource('bluetooth')
    const snaps: LinkSnapshot[] = []
    const { ws } = await started(src, snaps)
    src.failNext = true
    src.cb!.onLost('Bluetooth connection lost')
    expect(ws.json().at(-1)).toMatchObject({ type: 'link', to: 'disconnected' })
    expect(snaps.at(-1)!.phase).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(25)    // first retry fails
    await vi.advanceTimersByTimeAsync(25)    // second retry succeeds
    expect(src.starts).toBe(3)
    expect(snaps.at(-1)!.phase).toBe('streaming')
    expect(ws.json().filter((m) => m.type === 'link').map((m) => m.to).slice(-2)).toEqual(['connecting', 'connected'])
  })

  it('USB cable pulled: stops and closes without "bye" (server records an unexpected disconnect)', async () => {
    const src = new FakeSource('usb')
    const snaps: LinkSnapshot[] = []
    const { ws } = await started(src, snaps)
    src.cb!.onLost('USB cable disconnected')
    expect(snaps.at(-1)!.phase).toBe('stopped')
    expect(snaps.at(-1)!.message).toContain('Plug it back in')
    expect(ws.json().some((m) => m.type === 'bye')).toBe(false)
  })

  it('server drop: keeps frames and sends them after reconnecting', async () => {
    const src = new FakeSource()
    const { ws } = await started(src)
    ws.drop(1006)
    src.cb!.onBytes(V.ecg_6, 5)
    await vi.advanceTimersByTimeAsync(20)
    expect(ws.binary()).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1100)  // backoff 1 s
    const ws2 = FakeWS.last.at(-1)!
    expect(ws2).not.toBe(ws)
    ws2.server({ type: 'authenticated' })
    ws2.server({ type: 'welcome', session_id: 's2' })
    await vi.advanceTimersByTimeAsync(20)
    expect(ws2.binary().flatMap(decodeBatch).map(([, f]) => f)).toEqual([V.ecg_6])
  })

  it.each([[4409, 'already streaming'], [4403, 'operator rights'], [4401, 'sign-in has expired']])(
    'refusal %i stops with a clear message', async (code, text) => {
      const src = new FakeSource()
      const snaps: LinkSnapshot[] = []
      const link = new DeviceLink({ source: src, deviceId: 'd', getToken: () => 't', url: 'ws://x', onChange: (s) => snaps.push(s),
        WebSocketImpl: FakeWS as unknown as typeof WebSocket })
      const p = link.start()
      await vi.advanceTimersByTimeAsync(1)
      FakeWS.last.at(-1)!.drop(code)
      await expect(p).rejects.toThrow(text)
      expect(snaps.at(-1)!.phase).toBe('error')
      expect(src.starts).toBe(0)
    })

  it('Disconnect sends the rest, then a deliberate "bye" (no disconnect alarm)', async () => {
    const src = new FakeSource()
    const { link, ws } = await started(src)
    src.cb!.onBytes(V.imu_2, 9)
    await link.stop()
    expect(src.stopped).toBe(true)
    expect(ws.binary().flatMap(decodeBatch).map(([, f]) => f)).toEqual([V.imu_2])
    expect(ws.json().at(-1)).toEqual({ type: 'bye' })
    expect(ws.json().some((m) => m.type === 'link' && m.to === 'disconnected')).toBe(false)   // no false alarm
  })
})

describe('linkSupport', () => {
  const nav = (ua: string, extra: object = {}) => ({ userAgent: ua, ...extra }) as unknown as Navigator
  it('explains what is missing in plain words', () => {
    const android = linkSupport(nav('Mozilla/5.0 (Linux; Android 14) Chrome/130', { bluetooth: {} }), true)
    expect(android.bluetooth).toBe(true)
    expect(android.usb).toBe(false)
    expect(android.usbWhy).toContain('not on a phone')
    const android138 = linkSupport(nav('Mozilla/5.0 (Linux; Android 15) Chrome/140', { bluetooth: {}, serial: {} }), true)
    expect(android138.usb).toBe(false)                  // Android's serial API is Bluetooth-only
    const linux = linkSupport(nav('Mozilla/5.0 (X11; Linux x86_64) Chrome/130', { serial: {} }), true)
    expect(linux.usb).toBe(true)
    expect(linux.bluetoothWhy).toContain('chrome://flags')
    expect(linkSupport(nav('x', { bluetooth: {}, serial: {} }), false).bluetoothWhy).toContain('https')
  })
})
