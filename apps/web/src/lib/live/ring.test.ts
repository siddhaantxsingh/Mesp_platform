import { describe, expect, it } from 'vitest'
import { TimeRing } from './ring'

describe('TimeRing', () => {
  it('stores samples with timestamps and wraps', () => {
    const r = new TimeRing(10, 1)
    r.push(100, 10, [[1, 2, 3, 4, 5, 6, 7, 8]])
    r.push(100.8, 10, [[9, 10, 11, 12]])
    expect(r.size).toBe(10)
    const seen: number[] = []
    r.forEach(-Infinity, Infinity, (_t, i) => seen.push(r.ch[0][i]))
    expect(seen).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(r.latest()).toBe(12)
    expect(r.rate()).toBeCloseTo(10, 5)
  })
  it('inserts a NaN break on gaps', () => {
    const r = new TimeRing(100, 1)
    r.push(0, 10, [[1, 1, 1]])
    r.push(5, 10, [[2, 2]])
    const vals: number[] = []
    r.forEach(-1, 10, (_t, i) => vals.push(r.ch[0][i]))
    expect(vals.length).toBe(6)
    expect(Number.isNaN(vals[3])).toBe(true)
  })
  it('explicit gap flag also breaks the line', () => {
    const r = new TimeRing(100, 1)
    r.push(0, 10, [[1, 1]])
    r.push(0.2, 10, [[2]], true)
    const vals: number[] = []
    r.forEach(-1, 10, (_t, i) => vals.push(r.ch[0][i]))
    expect(vals.some(Number.isNaN)).toBe(true)
  })
  it('drops overlapping (backwards) data instead of drawing it', () => {
    const r = new TimeRing(100, 1)
    r.push(0, 10, [[1, 2, 3, 4]])
    r.push(0.1, 10, [[9, 9, 9, 5, 6]])
    const ts: number[] = []
    r.forEach(-1, 10, (t) => ts.push(t))
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1])
  })
  it('window query uses binary search bounds', () => {
    const r = new TimeRing(1000, 1)
    r.push(0, 100, [Array.from({ length: 1000 }, (_, i) => i)])
    let n = 0
    r.forEach(2, 3, () => n++)
    expect(n).toBe(101)
  })
})
