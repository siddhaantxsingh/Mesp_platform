/**
 * MESP link protocol v1 — TypeScript port of mesp_protocol (Python).
 * Verified against the same firmware-generated vectors (../vectors/firmware_vectors.json).
 * Intended for browser-side tooling (e.g. a future Web Bluetooth path); the platform's
 * production decode path is the Python pipeline.
 */
export const MAGIC0 = 0xaa
export const MAGIC1 = 0x55
export const HEADER_LEN = 7
export const TRAILER_LEN = 2
export const MAX_PAYLOAD = 1008

export enum FrameType { PPG_RAW = 1, IMU_RAW = 2, STATUS = 3, TEXT = 4, ECG_RAW = 5 }
const KNOWN = new Set([1, 2, 3, 4, 5])

export interface Frame { version: number; type: number; seq: number; payload: Uint8Array; crc: number }

const TABLE = (() => {
  const t = new Uint16Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i << 8
    for (let b = 0; b < 8; b++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff
    t[i] = c
  }
  return t
})()

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), identical to crc16_ccitt() in nrf_link.c */
export function crc16(data: Uint8Array, crc = 0xffff): number {
  for (let i = 0; i < data.length; i++) crc = ((crc << 8) & 0xffff) ^ TABLE[((crc >> 8) ^ data[i]) & 0xff]
  return crc
}

export function encodeFrame(type: number, seq: number, payload: Uint8Array, version = 1): Uint8Array {
  if (payload.length > MAX_PAYLOAD) throw new RangeError('payload too large')
  const out = new Uint8Array(HEADER_LEN + payload.length + TRAILER_LEN)
  out.set([MAGIC0, MAGIC1, version, type, seq & 0xff, payload.length & 0xff, payload.length >> 8])
  out.set(payload, HEADER_LEN)
  const c = crc16(out.subarray(2, HEADER_LEN + payload.length))
  out[out.length - 2] = c & 0xff
  out[out.length - 1] = c >> 8
  return out
}

export interface DeframerStats { bytesIn: number; framesOk: number; crcErrors: number; lengthErrors: number; unsupported: number; bytesDiscarded: number }

/** Incremental byte-stream deframer with the same resynchronisation rules as the Python one. */
export class Deframer {
  private buf = new Uint8Array(0)
  stats: DeframerStats = { bytesIn: 0, framesOk: 0, crcErrors: 0, lengthErrors: 0, unsupported: 0, bytesDiscarded: 0 }

  feed(chunk: Uint8Array): Frame[] {
    this.stats.bytesIn += chunk.length
    const b = new Uint8Array(this.buf.length + chunk.length)
    b.set(this.buf); b.set(chunk, this.buf.length)
    let pos = 0
    const out: Frame[] = []
    const find = (from: number) => { for (let i = from; i + 1 < b.length; i++) if (b[i] === MAGIC0 && b[i + 1] === MAGIC1) return i; return -1 }
    const validAt = (i: number): boolean => {
      if (b.length - i < HEADER_LEN) return false
      const len = b[i + 5] | (b[i + 6] << 8)
      const end = i + HEADER_LEN + len + TRAILER_LEN
      if (len > MAX_PAYLOAD || end > b.length) return false
      return crc16(b.subarray(i + 2, end - 2)) === (b[end - 2] | (b[end - 1] << 8))
    }
    for (;;) {
      const idx = find(pos)
      if (idx < 0) {
        const keep = b.length > pos && b[b.length - 1] === MAGIC0 ? 1 : 0
        this.stats.bytesDiscarded += b.length - pos - keep
        pos = b.length - keep
        break
      }
      this.stats.bytesDiscarded += idx - pos
      pos = idx
      if (b.length - pos < HEADER_LEN) break
      const len = b[pos + 5] | (b[pos + 6] << 8)
      const plausible = b[pos + 2] === 1 && KNOWN.has(b[pos + 3])
      if (len > MAX_PAYLOAD) { this.stats.lengthErrors++; this.stats.bytesDiscarded++; pos++; continue }
      const total = HEADER_LEN + len + TRAILER_LEN
      if (b.length - pos < total) {
        let laterValid = false
        for (let j = find(pos + 1); j >= 0; j = find(j + 1)) if (validAt(j)) { laterValid = true; break }
        if (!plausible || laterValid) { this.stats.bytesDiscarded++; pos++; continue }
        break
      }
      const rx = b[pos + total - 2] | (b[pos + total - 1] << 8)
      if (crc16(b.subarray(pos + 2, pos + total - 2)) !== rx) { this.stats.crcErrors++; this.stats.bytesDiscarded++; pos++; continue }
      const frame: Frame = { version: b[pos + 2], type: b[pos + 3], seq: b[pos + 4], payload: b.slice(pos + 7, pos + 7 + len), crc: rx }
      pos += total
      if (!plausible) { this.stats.unsupported++; continue }
      this.stats.framesOk++
      out.push(frame)
    }
    this.buf = b.slice(pos)
    return out
  }
}

export function decodePpg(p: Uint8Array): { red: number[]; ir: number[] } {
  if (p.length % 6) throw new RangeError('PPG payload not a multiple of 6')
  const red: number[] = [], ir: number[] = []
  for (let o = 0; o < p.length; o += 6) {
    red.push(((p[o] & 3) << 16) | (p[o + 1] << 8) | p[o + 2])
    ir.push(((p[o + 3] & 3) << 16) | (p[o + 4] << 8) | p[o + 5])
  }
  return { red, ir }
}

export function decodeImu(p: Uint8Array): number[][] {
  if (p.length % 14) throw new RangeError('IMU payload not a multiple of 14')
  const v = new DataView(p.buffer, p.byteOffset, p.byteLength)
  const out: number[][] = []
  for (let o = 0; o < p.length; o += 14) out.push([0, 2, 4, 6, 8, 10, 12].map((k) => v.getInt16(o + k, false)))
  return out
}

export function decodeEcg(p: Uint8Array): number[] {
  if (p.length % 2) throw new RangeError('ECG payload not a multiple of 2')
  const v = new DataView(p.buffer, p.byteOffset, p.byteLength)
  const out: number[] = []
  for (let o = 0; o < p.length; o += 2) out.push(v.getUint16(o, false))
  return out
}

export function decodeText(p: Uint8Array): string {
  return new TextDecoder('ascii').decode(p).replace(/[\r\n\0]+$/, '')
}
