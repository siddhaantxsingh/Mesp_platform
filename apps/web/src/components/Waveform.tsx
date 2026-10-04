import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Maximize2, Minimize2, Pause, Play, ZoomIn, ZoomOut } from 'lucide-react'
import type { TimeRing } from '@/lib/live/ring'
import { cssColor } from '@mesp/ui'
import { cn, prefersReducedMotion } from '@/lib/utils'
import { Tip } from './ui/tooltip'

export interface Trace { ring: TimeRing; channel: number; color: string; label: string; width?: number }

interface Props {
  traces: Trace[]
  title: string
  unit?: string
  windows?: number[]          // selectable window lengths (s)
  defaultWindow?: number
  yRange?: [number, number] | 'auto'
  minSpan?: number            // auto-scale never zooms tighter than this
  grid?: 'ecg' | 'plain'
  height?: number
  className?: string
  emptyHint?: string
}

const LAG = 0.12 // draw slightly behind the newest sample so batches arrive before they scroll in

export function Waveform({
  traces, title, unit, windows = [2.5, 5, 10, 20], defaultWindow = 5, yRange = 'auto', minSpan = 1e-6,
  grid = 'plain', height = 180, className, emptyHint = 'Waiting for samples…',
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [win, setWin] = useState(defaultWindow)
  const [paused, setPaused] = useState(false)
  const [full, setFull] = useState(false)
  const [hasData, setHasData] = useState(false)
  const [readout, setReadout] = useState('')
  const st = useRef({ anchorT: 0, anchorWall: 0, lastVersion: -1, pausedAt: 0, pan: 0, yLo: 0, yHi: 1, drag: null as null | { x: number; pan: number } })

  const reduced = prefersReducedMotion()

  // ---- render loop
  useEffect(() => {
    let raf = 0
    let lastDraw = 0
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const colors = { minor: '', major: '', text: '', bg: '' }
    const refreshColors = () => {
      colors.minor = cssColor('--grid-minor'); colors.major = cssColor('--grid-major'); colors.text = cssColor('--muted')
    }
    refreshColors()
    const mo = new MutationObserver(refreshColors)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      const s = st.current
      const ring0 = traces[0]?.ring
      if (!ring0) return
      const changed = ring0.version !== s.lastVersion
      if (reduced && !changed && now - lastDraw < 1000) return
      if (!reduced && now - lastDraw < 14) return // ~60 fps cap
      lastDraw = now
      if (changed) {
        s.lastVersion = ring0.version
        s.anchorT = ring0.lastT - LAG
        s.anchorWall = now
      }
      const dpr = window.devicePixelRatio || 1
      const W = canvas.clientWidth, H = canvas.clientHeight
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      if (!ring0.size) { if (hasData) setHasData(false); return }
      if (!hasData) setHasData(true)

      let tEnd: number
      if (paused) tEnd = s.pausedAt - s.pan
      else tEnd = reduced ? ring0.lastT : Math.min(ring0.lastT, s.anchorT + (now - s.anchorWall) / 1000)
      const tStart = tEnd - win

      // ---- y range
      let lo = Infinity, hi = -Infinity
      if (yRange === 'auto') {
        for (const tr of traces) tr.ring.forEach(tStart, tEnd, (_t, i) => {
          const v = tr.ring.ch[tr.channel][i]
          if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v }
        })
        if (lo === Infinity) { lo = s.yLo; hi = s.yHi }
        let span = Math.max(hi - lo, minSpan)
        const mid = (hi + lo) / 2
        lo = mid - span * 0.6; hi = mid + span * 0.6
        // ease the range so autoscale doesn't jitter
        const k = reduced ? 1 : 0.15
        s.yLo += (lo - s.yLo) * k; s.yHi += (hi - s.yHi) * k
        if (!Number.isFinite(s.yLo) || !Number.isFinite(s.yHi) || s.yHi - s.yLo <= 0) { s.yLo = lo; s.yHi = hi }
        lo = s.yLo; hi = s.yHi
        span = hi - lo
      } else [lo, hi] = yRange
      const padT = 6, padB = 16
      const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB)
      const x = (t: number) => ((t - tStart) / win) * W

      // ---- grid
      if (grid === 'ecg') {
        // 40 ms / 200 ms columns, like ECG paper (time only; amplitude is not calibrated in mV)
        for (const [step, color] of [[0.04, colors.minor], [0.2, colors.major]] as const) {
          if (win / step > W / 3) continue
          ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath()
          for (let t = Math.ceil(tStart / step) * step; t < tEnd; t += step) { const xx = Math.round(x(t)) + 0.5; ctx.moveTo(xx, 0); ctx.lineTo(xx, H - padB) }
          ctx.stroke()
        }
      } else {
        ctx.strokeStyle = colors.minor; ctx.lineWidth = 1; ctx.beginPath()
        for (let i = 1; i < 4; i++) { const yy = Math.round(padT + (i / 4) * (H - padT - padB)) + 0.5; ctx.moveTo(0, yy); ctx.lineTo(W, yy) }
        ctx.stroke()
      }
      // seconds ticks
      ctx.fillStyle = colors.text; ctx.font = '10px "JetBrains Mono Variable", ui-monospace, monospace'; ctx.textBaseline = 'alphabetic'
      const tickStep = win <= 5 ? 1 : win <= 10 ? 2 : 5
      for (let t = Math.ceil(tStart / tickStep) * tickStep; t < tEnd; t += tickStep) {
        const xx = x(t)
        ctx.fillRect(Math.round(xx), H - padB, 1, 4)
        const rel = t - tEnd
        ctx.fillText(`${rel.toFixed(0)}s`, xx + 3, H - 3)
      }

      // ---- traces: min/max per pixel column, NaN = gap
      for (const tr of traces) {
        const ring = tr.ring, ch = ring.ch[tr.channel]
        ctx.strokeStyle = tr.color; ctx.lineWidth = tr.width ?? 1.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round'
        ctx.beginPath()
        let col = -1, cMin = 0, cMax = 0, cLast = 0, open = false
        const flush = () => {
          if (col < 0) return
          const yMin = y(cMin), yMax = y(cMax)
          if (!open) { ctx.moveTo(col, y(cLast)); open = true }
          if (cMax !== cMin) { ctx.lineTo(col, yMax); ctx.lineTo(col, yMin) }
          ctx.lineTo(col, y(cLast))
        }
        const dense = ring.rate() * win > W * 1.5 // several samples per pixel column
        ring.forEach(tStart - 0.05, tEnd, (t, i) => {
          const v = ch[i]
          if (v !== v) { flush(); col = -1; open = false; return }
          if (!dense) {
            const xx = x(t), yy = y(v)
            if (!open) { ctx.moveTo(xx, yy); open = true } else ctx.lineTo(xx, yy)
            return
          }
          const c = Math.round(x(t))
          if (c !== col) { flush(); col = c; cMin = cMax = v }
          else { if (v < cMin) cMin = v; if (v > cMax) cMax = v }
          cLast = v
        })
        if (dense) flush()
        ctx.stroke()
      }
      if (paused) {
        ctx.fillStyle = cssColor('--warning', 0.9)
        ctx.font = '600 10px "Inter Variable", system-ui'
        ctx.fillText('PAUSED', 8, 14)
      }
    }
    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); mo.disconnect() }
  }, [traces, win, paused, yRange, minSpan, grid, reduced, hasData])

  // ---- accessible numeric readout (throttled)
  useEffect(() => {
    const id = setInterval(() => {
      const parts = traces.map((t) => {
        const v = t.ring.latest(t.channel)
        return `${t.label} ${v == null || v !== v ? '—' : v.toFixed(Math.abs(v) < 10 ? 2 : 0)}`
      })
      setReadout(parts.join(', '))
    }, 1000)
    return () => clearInterval(id)
  }, [traces])

  const togglePause = useCallback(() => {
    setPaused((p) => {
      const s = st.current
      if (!p) { s.pausedAt = traces[0]?.ring.lastT ?? 0; s.pan = 0 }
      return !p
    })
  }, [traces])

  const zoom = (dir: 1 | -1) => setWin((w) => {
    const i = windows.indexOf(w)
    return windows[Math.min(windows.length - 1, Math.max(0, (i < 0 ? 1 : i) + dir))]
  })

  const toggleFull = async () => {
    const el = wrapRef.current
    if (!el) return
    if (document.fullscreenElement) { await document.exitFullscreen(); setFull(false) }
    else if (el.requestFullscreen) { await el.requestFullscreen(); setFull(true) }
  }
  useEffect(() => {
    const h = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', h)
    return () => document.removeEventListener('fullscreenchange', h)
  }, [])

  const onKey = (e: KeyboardEvent) => {
    const s = st.current
    if (e.key === ' ') { e.preventDefault(); togglePause() }
    else if (e.key === '+' || e.key === '=') zoom(-1)
    else if (e.key === '-') zoom(1)
    else if (e.key.toLowerCase() === 'f') toggleFull()
    else if (paused && e.key === 'ArrowLeft') { e.preventDefault(); s.pan = Math.min(s.pan + win / 4, 55) }
    else if (paused && e.key === 'ArrowRight') { e.preventDefault(); s.pan = Math.max(0, s.pan - win / 4) }
    else if (e.key === '0') { s.pan = 0; setWin(defaultWindow) }
  }

  const onPointerDown = (e: PointerEvent) => {
    if (!paused) return
    st.current.drag = { x: e.clientX, pan: st.current.pan }
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent) => {
    const s = st.current
    if (!s.drag || !canvasRef.current) return
    const dt = ((e.clientX - s.drag.x) / canvasRef.current.clientWidth) * win
    s.pan = Math.min(55, Math.max(0, s.drag.pan + dt))
  }
  const onPointerUp = () => { st.current.drag = null }

  return (
    <div
      ref={wrapRef}
      className={cn('group relative rounded-md bg-surface focus-within:ring-2 focus-within:ring-ring', full && 'flex flex-col justify-center bg-background p-6', className)}
    >
      <div
        tabIndex={0}
        role="img"
        aria-roledescription="live waveform"
        aria-label={`${title}${unit ? ` (${unit})` : ''}. ${paused ? 'Paused.' : 'Live.'} Latest: ${readout}. Space to pause, plus/minus to zoom, F for full screen.`}
        onKeyDown={onKey}
        className="relative outline-none"
        style={{ height: full ? '70vh' : height }}
      >
        <canvas
          ref={canvasRef}
          className={cn('absolute inset-0 h-full w-full', paused && 'cursor-grab active:cursor-grabbing')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={togglePause}
        />
        {!hasData && (
          <div className="absolute inset-0 grid place-items-center text-xs text-muted">{emptyHint}</div>
        )}
      </div>
      <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        <span className="pointer-events-auto mr-1 rounded bg-surface/80 px-1.5 py-0.5 font-mono text-[10px] text-muted backdrop-blur">{win}s</span>
        <ToolBtn label={paused ? 'Resume (Space)' : 'Pause (Space)'} onClick={togglePause}>{paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}</ToolBtn>
        <ToolBtn label="Zoom in (+)" onClick={() => zoom(-1)} disabled={win === windows[0]}><ZoomIn className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn label="Zoom out (−)" onClick={() => zoom(1)} disabled={win === windows[windows.length - 1]}><ZoomOut className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn label={full ? 'Exit full screen (F)' : 'Full screen (F)'} onClick={toggleFull}>{full ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}</ToolBtn>
      </div>
      {paused && <div className="pointer-events-none absolute bottom-5 left-2 text-[10px] text-muted">Drag or ←/→ to pan</div>}
    </div>
  )
}

function ToolBtn({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <Tip content={label}>
      <button type="button" aria-label={label} onClick={onClick} disabled={disabled}
        className="pointer-events-auto grid h-7 w-7 place-items-center rounded-md border border-border bg-surface/90 text-foreground backdrop-blur hover:bg-surface-2 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {children}
      </button>
    </Tip>
  )
}
