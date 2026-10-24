import { useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { signal, tokenColor, useCanvas, useMotion, type SignalKind } from './motion'

const SENSORS: { kind: SignalKind; label: string; chip: string; title: string; body: string; spec: string; scope: string; token: string }[] = [
  { kind: 'ecg', label: 'Electrical', chip: 'ECG · AD8232', title: 'It starts with a heartbeat.', token: '--signal-ecg',
    body: 'A single-lead ECG front end, sampled by a timer-triggered 12-bit ADC and moved straight into memory by DMA.', spec: '1,000 Hz · 12-bit ADC', scope: 'ECG · electrical activity' },
  { kind: 'ppg', label: 'Optical', chip: 'PPG · MAX30102', title: 'Light reveals another rhythm.', token: '--signal-ppg-ir',
    body: 'Red and infrared photoplethysmography add an optical view of the pulse. The sensor FIFO is drained over I²C into a lock-free ring.', spec: '25 Hz FIFO · 18-bit', scope: 'PPG · optical pulse' },
  { kind: 'imu', label: 'Motion', chip: 'IMU · MPU-6886', title: 'Movement gives it context.', token: '--signal-imu-x',
    body: 'A 6-axis accelerometer and gyroscope show how the wrist moves — for activity, orientation, fall detection and motion-artefact gating.', spec: '1,000 Hz · ±4 g · ±500 °/s', scope: 'IMU · three-axis motion' },
]
const TOUR_S = 7

/** Tabbed sensor explorer with an animated, clearly illustrative oscilloscope. */
export function SignalDeck() {
  const [sel, setSel] = useState(0)
  const [tour, setTour] = useState(true)
  const paused = useMotion((s) => s.paused)
  const blend = useRef([1, 0, 0])
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const deck = useRef<HTMLDivElement>(null)
  const [onScreen, setOnScreen] = useState(false)

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { threshold: 0.4 })
    if (deck.current) io.observe(deck.current)
    return () => io.disconnect()
  }, [])
  const touring = tour && !paused && onScreen
  useEffect(() => {
    if (!touring) return
    const id = setInterval(() => setSel((s) => (s + 1) % 3), TOUR_S * 1000)
    return () => clearInterval(id)
  }, [touring])

  const choose = (n: number, focus = false) => { setTour(false); setSel(n); if (focus) tabs.current[n]?.focus() }

  const { ref } = useCanvas((ctx, w, h, t) => {
    const el = ref.current!
    const grid = tokenColor(el, '--foreground')
    ctx.strokeStyle = grid(0.06); ctx.lineWidth = 0.6; ctx.beginPath()
    for (let x = 0; x < w; x += 30) { ctx.moveTo(x, 0); ctx.lineTo(x, h) }
    for (let y = 0; y < h; y += 26) { ctx.moveTo(0, y); ctx.lineTo(w, y) }
    ctx.stroke()
    blend.current = blend.current.map((v, i) => (paused ? (i === sel ? 1 : 0) : v + ((i === sel ? 1 : 0) - v) * 0.09))
    blend.current.forEach((a, i) => {
      if (a < 0.01) return
      const chans = i === 2 ? 3 : 1
      for (let ch = 0; ch < chans; ch++) {
        const col = tokenColor(el, i === 2 ? ['--signal-imu-x', '--signal-imu-y', '--signal-imu-z'][ch] : SENSORS[i].token)
        ctx.beginPath()
        for (let x = 0; x <= w; x += 1.5) {
          const y = h * (0.6 + ch * 0.1) - signal(SENSORS[i].kind, (x / w) * 4.3 + t * 0.27, ch) * h * 0.45
          x ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
        }
        ctx.strokeStyle = col(a * (ch ? 0.8 : 1)); ctx.lineWidth = 1.7; ctx.stroke()
      }
    })
  }, [sel])

  const s = SENSORS[sel]
  return (
    <div ref={deck} className="mt-12 overflow-hidden rounded-2xl border border-border bg-[radial-gradient(ellipse_at_70%_55%,hsl(var(--primary)/.08),transparent_70%)] bg-surface shadow-[0_30px_80px_-30px_rgba(0,0,0,.6)]">
      <div role="tablist" aria-label="Explore the three sensors" className="grid grid-cols-3 border-b border-border">
        {SENSORS.map((x, i) => (
          <button key={x.kind} ref={(b) => { tabs.current[i] = b }} role="tab" id={`sensor-tab-${i}`} aria-selected={sel === i} aria-controls="sensor-panel"
            tabIndex={sel === i ? 0 : -1} onClick={() => choose(i)}
            onKeyDown={(e) => {
              const n = e.key === 'ArrowRight' ? (i + 1) % 3 : e.key === 'ArrowLeft' ? (i + 2) % 3 : e.key === 'Home' ? 0 : e.key === 'End' ? 2 : -1
              if (n >= 0) { e.preventDefault(); choose(n, true) }
            }}
            className={cn('relative border-r border-border px-3 py-4 text-left transition-colors last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-7 sm:py-5',
              sel === i ? 'bg-primary/[.06] text-primary' : 'text-muted hover:text-foreground')}>
            <span className="block text-sm font-semibold sm:text-base">{String(i + 1).padStart(2, '0')} · {x.label}</span>
            <span className="mt-1 block font-mono text-xs text-muted"><span className="sm:hidden">{x.chip.split(' · ')[0]}</span><span className="hidden sm:inline">{x.chip}</span></span>
            <span className={cn('absolute inset-x-4 -bottom-px h-0.5 origin-left bg-primary transition-transform duration-500', sel === i ? 'scale-x-100' : 'scale-x-0')} aria-hidden />
          </button>
        ))}
      </div>
      <div id="sensor-panel" role="tabpanel" aria-labelledby={`sensor-tab-${sel}`} className="grid gap-8 p-6 sm:p-10 lg:grid-cols-[.75fr_1.25fr]">
        <div className="flex flex-col justify-center">
          <h3 className="text-2xl font-semibold tracking-tight sm:text-3xl">{s.title}</h3>
          <p className="mt-3 max-w-sm text-base leading-relaxed text-muted">{s.body}</p>
          <p className="mt-5 font-mono text-sm text-primary">{s.spec}</p>
        </div>
        <div className="min-w-0">
          <div className="mb-2 flex justify-between gap-3 font-mono text-xs uppercase tracking-wider text-muted"><span>{s.scope}</span><span>Illustrative</span></div>
          <canvas ref={ref} role="img" aria-label={`Illustrative ${s.scope} waveform, animated. Not a measurement.`} className="block h-[180px] w-full sm:h-[230px]" />
          <div className="mt-2 flex justify-between border-t border-border pt-3 font-mono text-xs text-muted"><span>{s.chip.split(' · ')[1]}</span><span>Not a measurement</span></div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-border bg-foreground/[.015] px-6 py-3 text-sm text-muted">
        <span className="inline-flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />Use the tabs or arrow keys to explore</span>
        <button type="button" onClick={() => setTour((v) => !v)} aria-pressed={tour}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md px-2 text-foreground/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {tour ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}Auto tour {tour ? 'on' : 'off'}
        </button>
      </div>
    </div>
  )
}

/** Thin ECG sweep for the hero top edge and the closing section (decorative). */
export function SweepLine({ className, sweep = true }: { className?: string; sweep?: boolean }) {
  const { ref } = useCanvas((ctx, w, h, t) => {
    const primary = tokenColor(ref.current!, '--primary')
    const at = (x: number) => h * 0.62 - signal('ecg', (x / w) * Math.max(3, w / 220)) * h * 0.5
    const trace = (end: number, a: number) => {
      ctx.beginPath()
      for (let x = 0; x <= end; x += 1.5) x ? ctx.lineTo(x, at(x)) : ctx.moveTo(x, at(x))
      ctx.strokeStyle = primary(a); ctx.lineWidth = 1.6; ctx.stroke()
    }
    trace(w, 0.13)
    if (!sweep) return
    const head = ((t * 0.12) % 1.2) * w
    trace(Math.min(w, head), 0.85)
    if (head < w) {
      const g = ctx.createRadialGradient(head, at(head), 0, head, at(head), 22)
      g.addColorStop(0, primary(0.5)); g.addColorStop(1, primary(0))
      ctx.fillStyle = g; ctx.fillRect(head - 22, at(head) - 22, 44, 44)
    }
  })
  return <canvas ref={ref} aria-hidden className={className} />
}
