import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { crc16, decodeEcg, decodeImu, decodePpg, decodeText, Deframer, encodeFrame, FrameType } from './index'

const vec = JSON.parse(readFileSync(fileURLToPath(new URL('../../vectors/firmware_vectors.json', import.meta.url)), 'utf8'))
const V: Record<string, Uint8Array> = Object.fromEntries(
  vec.vectors.map((v: { name: string; hex: string }) => [v.name, Uint8Array.from(v.hex.match(/../g)!.map((h) => parseInt(h, 16)))]),
)
const one = (b: Uint8Array) => { const d = new Deframer(); const f = d.feed(b); expect(f).toHaveLength(1); return f[0] }

describe('firmware conformance (TS)', () => {
  it('crc check value', () => expect(crc16(new TextEncoder().encode('123456789'))).toBe(0x29b1))
  it('ppg', () => {
    const f = one(V.ppg_4)
    expect(f.type).toBe(FrameType.PPG_RAW)
    expect(decodePpg(f.payload)).toEqual({ red: [0x3ffff, 123456, 0, 100000], ir: [1, 234567, 0x2abcd, 200000] })
  })
  it('imu', () => expect(decodeImu(one(V.imu_2).payload)).toEqual([[8192, -8192, 0, -1234, 655, -655, 32767], [-32768, 1, -1, 0, 0, 1, -2]]))
  it('ecg', () => {
    expect(decodeEcg(one(V.ecg_6).payload)).toEqual([0, 2048, 4095, 1, 0x0abc, 3000])
    expect(decodeEcg(one(V.ecg_max).payload)).toHaveLength(504)
  })
  it('text', () => expect(decodeText(one(V.text_boot).payload)).toBe('boot: ppg=25sps imu=1kHz'))
  it('encoder reproduces firmware bytes', () => {
    for (const raw of Object.values(V)) {
      const f = one(raw)
      expect(Array.from(encodeFrame(f.type, f.seq, f.payload))).toEqual(Array.from(raw))
    }
  })
  it('any chunking, with garbage and corruption', () => {
    const all = Object.values(V)
    const bad = V.ecg_6.slice(); bad[10] ^= 0xff
    const parts = [Uint8Array.from([0, 0x13, 0xaa, 0x55, 1]), ...all.slice(0, 3), bad, ...all.slice(3)]
    const stream = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let o = 0; for (const p of parts) { stream.set(p, o); o += p.length }
    const d = new Deframer(); const got = []
    for (let i = 0; i < stream.length; i += 37) got.push(...d.feed(stream.subarray(i, i + 37)))
    expect(got).toHaveLength(all.length)
    expect(d.stats.crcErrors).toBeGreaterThanOrEqual(1)
  })
})
