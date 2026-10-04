/**
 * Fixed-capacity time-series ring buffer (multi-channel, Float32 values, Float64 timestamps).
 * Gaps are stored as a NaN sample so renderers break the line instead of bridging missing data.
 */
export class TimeRing {
  readonly t: Float64Array
  readonly ch: Float32Array[]
  private head = 0
  size = 0
  lastT = -Infinity
  version = 0

  constructor(readonly capacity: number, readonly channels: number) {
    this.t = new Float64Array(capacity)
    this.ch = Array.from({ length: channels }, () => new Float32Array(capacity))
  }

  private put(t: number, vals: ArrayLike<number> | null) {
    const i = this.head
    this.t[i] = t
    for (let c = 0; c < this.channels; c++) this.ch[c][i] = vals ? vals[c] : NaN
    this.head = (i + 1) % this.capacity
    if (this.size < this.capacity) this.size++
    this.lastT = t
  }

  /** values[c][k] for channel c, sample k; samples are t0 + k/fs */
  push(t0: number, fs: number, values: ArrayLike<number>[], gap = false) {
    const n = values[0]?.length ?? 0
    if (!n) return
    const dt = 1 / fs
    if (this.size && (gap || t0 - this.lastT > 3 * dt)) this.put(this.lastT + dt, null)
    if (t0 < this.lastT - dt / 2) {
      // out-of-order / overlapping data: drop the overlapping part rather than draw backwards
      const skip = Math.ceil((this.lastT - t0) / dt)
      if (skip >= n) return
      t0 += skip * dt
      values = values.map((v) => Array.prototype.slice.call(v, skip))
    }
    const row = new Array(this.channels)
    for (let k = 0; k < (values[0]?.length ?? 0); k++) {
      for (let c = 0; c < this.channels; c++) row[c] = values[c][k]
      this.put(t0 + k * dt, row)
    }
    this.version++
  }

  /** Iterate samples (oldest first) with t in [from, to]. Returns number visited. */
  forEach(from: number, to: number, fn: (t: number, idx: number) => void): number {
    let visited = 0
    const start = (this.head - this.size + this.capacity) % this.capacity
    // binary search for first t >= from over the logical order
    let lo = 0, hi = this.size
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.t[(start + mid) % this.capacity] < from) lo = mid + 1
      else hi = mid
    }
    for (let k = lo; k < this.size; k++) {
      const i = (start + k) % this.capacity
      const t = this.t[i]
      if (t > to) break
      fn(t, i)
      visited++
    }
    return visited
  }

  /** Approximate sample rate from buffer contents (Hz). */
  rate(): number {
    if (this.size < 2) return 0
    const oldest = this.t[(this.head - this.size + this.capacity) % this.capacity]
    return (this.size - 1) / Math.max(1e-6, this.lastT - oldest)
  }

  latest(c = 0): number | null {
    if (!this.size) return null
    return this.ch[c][(this.head - 1 + this.capacity) % this.capacity]
  }

  clear() {
    this.head = 0; this.size = 0; this.lastT = -Infinity; this.version++
  }
}
