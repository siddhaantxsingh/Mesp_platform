/**
 * Landing-page motion: one switch for every animation on the page (WCAG 2.2.2 "Pause, Stop, Hide"),
 * off by default for people who ask their system for reduced motion, and a canvas loop that only
 * runs while its canvas is on screen and the tab is visible.
 */
import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { prefersReducedMotion } from '@/lib/utils'

interface MotionState { paused: boolean; toggle: () => void; set: (p: boolean) => void }
export const useMotion = create<MotionState>((set) => ({
  paused: prefersReducedMotion(),
  toggle: () => set((s) => ({ paused: !s.paused })),
  set: (paused) => set({ paused }),
}))
// follow the system setting if it changes while the page is open
if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', (e) => useMotion.getState().set(e.matches))
}

/* ------------------------------------------------------------------ illustrative signals (never data) */
const gauss = (p: number, c: number, w: number, a: number) => a * Math.exp(-0.5 * ((p - c) / w) ** 2)
export type SignalKind = 'ecg' | 'ppg' | 'imu'
export function signal(kind: SignalKind, t: number, ch = 0): number {
  const p = ((t % 1) + 1) % 1
  if (kind === 'ecg') return gauss(p, 0.17, 0.026, 0.12) + gauss(p, 0.325, 0.013, -0.16) + gauss(p, 0.355, 0.012, 1) + gauss(p, 0.4, 0.018, -0.24) + gauss(p, 0.65, 0.06, 0.27)
  if (kind === 'ppg') return gauss(p, 0.27, 0.085, 0.8) + gauss(p, 0.51, 0.08, 0.24) - 0.14
  return 0.14 * Math.sin(t * 4 + ch * 1.8) + 0.065 * Math.sin(t * 11 + ch) + 0.025 * Math.sin(t * 25)
}

/** Reads an HSL token (e.g. --primary) from the nearest themed ancestor and returns `hsl(... / a)`. */
export function tokenColor(el: Element, name: string) {
  const v = getComputedStyle(el).getPropertyValue(name).trim()
  return (a = 1) => `hsl(${v} / ${a})`
}

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void

/**
 * Runs `draw` on a HiDPI canvas. Time only advances while motion is on; the loop sleeps while the
 * canvas is off screen or the tab is hidden; a still frame is drawn when paused or resized.
 */
export function useCanvas(draw: Draw, deps: unknown[] = []) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef(draw)
  drawRef.current = draw
  const paused = useMotion((s) => s.paused)
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const time = useRef(3)
  const kick = useRef<() => void>(() => undefined)

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    let raf = 0, last = 0, visible = false, alive = true
    const frame = (now: number) => {
      raf = 0
      if (!alive) return
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0
      last = now
      if (!pausedRef.current) time.current += dt
      const w = c.clientWidth, h = c.clientHeight, d = Math.min(window.devicePixelRatio || 1, 2)
      if (w && h) {
        if (c.width !== Math.round(w * d) || c.height !== Math.round(h * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d) }
        ctx.setTransform(d, 0, 0, d, 0, 0)
        ctx.clearRect(0, 0, w, h)
        drawRef.current(ctx, w, h, time.current)
      }
      if (visible && !document.hidden && !pausedRef.current && !pausedUntilReady()) raf = requestAnimationFrame(frame)
      else last = 0
    }
    // the first frame draws at once; continuous animation waits until the page has finished loading
    let ready = document.readyState === 'complete' && performance.now() > 2500
    const start = () => { if (!raf) raf = requestAnimationFrame(frame) }
    const pausedUntilReady = () => !ready
    if (!ready) {
      const go = () => { ready = true; start() }
      const later = () => ('requestIdleCallback' in window ? (window as Window & { requestIdleCallback: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback(go, { timeout: 2500 }) : setTimeout(go, 1200))
      if (document.readyState === 'complete') setTimeout(later, 1200); else window.addEventListener('load', () => setTimeout(later, 1200), { once: true })
    }
    kick.current = start
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start() }, { rootMargin: '80px' })
    io.observe(c)
    const ro = new ResizeObserver(start)
    ro.observe(c)
    const onVis = () => start()
    document.addEventListener('visibilitychange', onVis)
    start()
    return () => { alive = false; cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); document.removeEventListener('visibilitychange', onVis) }
  }, [])

  // redraw when motion toggles or inputs change (e.g. a selected layer)
  useEffect(() => { kick.current() }, [paused, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps
  return { ref, kick: () => kick.current() }
}
