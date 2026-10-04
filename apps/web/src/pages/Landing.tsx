import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Bluetooth, Cpu, Database, Github, Radio, ShieldCheck, Waves } from 'lucide-react'
import { DISCLAIMER } from '@mesp/types'
import { Logo } from '@/components/Logo'
import { cn, prefersReducedMotion } from '@/lib/utils'
import { useAuth } from '@/lib/auth'

/* ------------------------------------------------------------------ helpers */
function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(prefersReducedMotion())
  useEffect(() => {
    if (shown || !ref.current) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect() } }, { rootMargin: '0px 0px -12% 0px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [shown])
  return (
    <div ref={ref} style={{ transitionDelay: `${delay}ms` }}
      className={cn('transition-[opacity,transform] duration-[900ms] ease-[cubic-bezier(.22,1,.36,1)]', shown ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0', className)}>
      {children}
    </div>
  )
}

function Eyebrow({ n, children }: { n: string; children: ReactNode }) {
  return <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.2em] text-primary"><span className="text-muted">{n}</span><span className="h-px w-8 bg-primary/50" />{children}</div>
}

/** Synthetic ECG-like curve for illustrations (clearly not data). */
function synthEcg(t: number) {
  const beat = 0.86, p = ((t % beat) + beat) % beat / beat
  const g = (c: number, w: number, a: number) => a * Math.exp(-0.5 * ((p - c) / w) ** 2)
  return g(0.18, 0.025, 0.12) + g(0.32, 0.01, -0.14) + g(0.35, 0.011, 1) + g(0.385, 0.012, -0.24) + g(0.62, 0.05, 0.3)
}

/* ------------------------------------------------------------------ hero canvas */
function HeroSignal() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current!, ctx = c.getContext('2d')!
    const reduced = prefersReducedMotion()
    let raf = 0
    const start = performance.now()
    const draw = (now: number) => {
      const dpr = window.devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight
      if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      const t = reduced ? 3 : (now - start) / 1000
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()
      const lines = 5
      for (let k = 0; k < lines; k++) {
        const y0 = H * (0.13 + k * 0.022), amp = H * (k === 2 ? 0.075 : 0.012 + 0.005 * Math.abs(2 - k))
        const alpha = k === 2 ? 0.95 : 0.07 + 0.03 * (2 - Math.abs(2 - k))
        ctx.strokeStyle = `hsl(${accent} / ${alpha})`
        ctx.lineWidth = k === 2 ? 2 : 1
        ctx.beginPath()
        const head = (t * 0.22) % 1.25
        for (let x = 0; x <= W; x += 2) {
          const u = x / W
          if (k === 2 && u > head) break
          const v = synthEcg(u * Math.max(2.5, W / 240) + k * 0.13 + (k === 2 ? 0 : t * 0.05))
          const y = y0 - v * amp
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
        }
        ctx.stroke()
        if (k === 2 && head <= 1) {
          const x = head * W, y = y0 - synthEcg(head * Math.max(2.5, W / 240) + k * 0.13) * amp
          const g = ctx.createRadialGradient(x, y, 0, x, y, 28)
          g.addColorStop(0, `hsl(${accent} / .55)`); g.addColorStop(1, `hsl(${accent} / 0)`)
          ctx.fillStyle = g; ctx.fillRect(x - 28, y - 28, 56, 56)
        }
      }
      if (!reduced) raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])
  return <canvas ref={ref} className="absolute inset-0 h-full w-full [mask-image:linear-gradient(90deg,transparent,black_18%,black_82%,transparent)]" aria-hidden />
}

/* ------------------------------------------------------------------ frame anatomy (real firmware bytes) */
// ECG_RAW frame produced by the firmware's own Nrf_SendECG() (packages/protocol/vectors, "ecg_6")
const FRAME_HEX = 'aa550105020c00000008000fff00010abc0bb85a21'
const BYTES = FRAME_HEX.match(/../g)!
const FIELDS = [
  { from: 0, to: 2, name: 'Sync', color: 'text-muted', text: '0xAA 0x55 marks the start of a frame. The deframer resynchronises on it after noise or a dropped byte.' },
  { from: 2, to: 3, name: 'Version', color: 'text-info', text: 'Protocol version 1. Frames with versions the platform does not speak are counted and dropped, never misread.' },
  { from: 3, to: 4, name: 'Type', color: 'text-ecg', text: '0x05 = ECG_RAW. Other types: PPG_RAW 0x01, IMU_RAW 0x02, STATUS 0x03, TEXT 0x04.' },
  { from: 4, to: 5, name: 'Sequence', color: 'text-warning', text: 'One 8-bit counter shared by every frame. Gaps reveal lost packets; repeats reveal duplicates.' },
  { from: 5, to: 7, name: 'Length', color: 'text-info', text: 'Payload length, little-endian (12 bytes here, up to 1008).' },
  { from: 7, to: 19, name: 'Payload', color: 'text-foreground', text: 'Six 12-bit ADC codes, big-endian: 0, 2048, 4095, 1, 2748, 3000. The link carries raw codes; the platform does the maths.' },
  { from: 19, to: 21, name: 'CRC-16', color: 'text-critical', text: 'CRC-16/CCITT-FALSE over version..payload. One flipped bit and the frame is rejected.' },
]

function FrameAnatomy() {
  const [sel, setSel] = useState(5)
  const f = FIELDS[sel]
  return (
    <div>
      <div className="flex flex-wrap gap-1.5" role="listbox" aria-label="Frame bytes, grouped by field">
        {FIELDS.map((fd, i) => (
          <button key={fd.name} role="option" aria-selected={sel === i} onMouseEnter={() => setSel(i)} onFocus={() => setSel(i)} onClick={() => setSel(i)}
            className={cn('group rounded-md border px-1.5 pb-1 pt-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              sel === i ? 'border-primary/60 bg-primary/10' : 'border-border bg-surface hover:border-primary/30')}>
            <div className="flex gap-1 font-mono text-[13px] sm:text-sm">
              {BYTES.slice(fd.from, fd.to).map((b, k) => <span key={k} className={cn(fd.color, 'tabular-nums')}>{b.toUpperCase()}</span>)}
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-wider text-muted">{fd.name}</div>
          </button>
        ))}
      </div>
      <div className="mt-5 min-h-[72px] rounded-lg border border-border bg-surface p-4" aria-live="polite">
        <div className={cn('text-xs font-semibold uppercase tracking-wider', f.color)}>{f.name}</div>
        <p className="mt-1 text-sm leading-relaxed text-muted">{f.text}</p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ mini sensor sparkline */
function Spark({ kind }: { kind: 'ecg' | 'ppg' | 'imu' }) {
  const pts: string[] = []
  for (let i = 0; i <= 120; i++) {
    const u = i / 120
    let v = 0
    if (kind === 'ecg') v = synthEcg(u * 2.6)
    else if (kind === 'ppg') { const p = (u * 2.6) % 1; v = 0.9 * Math.exp(-0.5 * ((p - 0.25) / 0.09) ** 2) + 0.35 * Math.exp(-0.5 * ((p - 0.55) / 0.1) ** 2) }
    else v = 0.45 + 0.3 * Math.sin(u * 18) + 0.12 * Math.sin(u * 47)
    pts.push(`${(u * 200).toFixed(1)},${(52 - v * 40).toFixed(1)}`)
  }
  const color = kind === 'ecg' ? 'stroke-ecg' : kind === 'ppg' ? 'stroke-ppg-ir' : 'stroke-imu-x'
  return (
    <svg viewBox="0 0 200 60" className="h-14 w-full" aria-hidden preserveAspectRatio="none">
      <polyline points={pts.join(' ')} fill="none" className={cn(color, 'landing-draw')} strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/* ------------------------------------------------------------------ page */
const PIPELINE = [
  ['Deframe', 'Byte stream → frames, resync on 0xAA55'], ['Verify', 'CRC-16 on every frame (again, server-side)'], ['Decode', 'Versioned adapter, device profile'],
  ['Timestamp', 'Per-sample time from nominal rate + host clock'], ['Sequence', '8-bit counter → loss & duplicate detection'], ['Persist', '1 s chunks in PostgreSQL'],
  ['Derive', 'R-peaks, pulse, SpO₂ estimate, motion, falls'], ['Events', 'Sustained-condition rules with hysteresis'], ['Stream', 'Versioned WebSocket to the browser'],
] as const

export default function Landing() {
  const token = useAuth((s) => s.token)
  const [active, setActive] = useState(0)
  useEffect(() => {
    if (prefersReducedMotion()) return
    const id = setInterval(() => setActive((a) => (a + 1) % PIPELINE.length), 1400)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="landing overflow-x-hidden">
      <a href="#story" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">Skip to content</a>
      <header className="fixed inset-x-0 top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-5">
          <Logo />
          <nav aria-label="Sections" className="hidden gap-5 text-xs text-muted md:flex">
            {[['signal', 'Signal'], ['processing', 'Processing'], ['connection', 'Connection'], ['platform', 'Platform'], ['data', 'Data'], ['system', 'System']].map(([id, l]) => (
              <a key={id} href={`#${id}`} className="hover:text-foreground">{l}</a>
            ))}
          </nav>
          <Link to={token ? '/app/live' : '/login'} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
            {token ? 'Open console' : 'Live demo'}<ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      {/* HERO */}
      <section className="relative flex min-h-[100svh] items-end overflow-hidden pb-20 pt-28 sm:items-center sm:pb-0">
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_70%_40%,hsl(var(--primary)/.10),transparent_70%)]" aria-hidden />
        <HeroSignal />
        <div className="relative mx-auto w-full max-w-6xl px-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/70 px-3 py-1 text-[11px] text-muted backdrop-blur">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />Engineering prototype · not a medical device
          </div>
          <h1 className="mt-6 max-w-4xl text-[clamp(2.6rem,7.5vw,6.2rem)] font-semibold leading-[0.95] tracking-[-0.045em]">
            Three sensors.<br /><span className="text-muted">One wrist.</span> <span className="bg-gradient-to-r from-primary to-ecg bg-clip-text text-transparent">Every byte accounted for.</span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
            MESP streams ECG, optical pulse and motion from an STM32 wristband over Bluetooth into a real-time platform. Every frame is checked, timed, sequenced and stored.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to={token ? '/app/live' : '/login'} className="inline-flex h-12 items-center gap-2 rounded-md bg-primary px-6 font-medium text-primary-foreground shadow-[0_10px_40px_-12px_hsl(var(--primary))] hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
              Watch it live <ArrowRight className="h-4 w-4" />
            </Link>
            <a href="#story" className="inline-flex h-12 items-center gap-2 rounded-md border border-border px-6 font-medium hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">How it works</a>
          </div>
          <p className="mt-4 text-[11px] text-muted">The live demo uses clearly labelled synthetic data.</p>
        </div>
      </section>

      <main id="story">
        {/* 01 SIGNAL */}
        <section id="signal" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-28">
          <Reveal><Eyebrow n="01">Signal</Eyebrow></Reveal>
          <Reveal delay={80}><h2 className="mt-5 max-w-3xl text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">It starts with a heartbeat, a pulse and a wrist.</h2></Reveal>
          <div className="mt-14 grid gap-4 md:grid-cols-3">
            {[
              { k: 'ecg' as const, chip: 'AD8232', title: 'Electrical', body: 'Single-lead ECG front end sampled by a timer-triggered 12-bit ADC at 1 kHz, DMA straight to memory.', spec: '1 000 Hz · 12-bit' },
              { k: 'ppg' as const, chip: 'MAX30102', title: 'Optical', body: 'Red and infrared photoplethysmography. The FIFO is drained over I²C into a lock-free ring.', spec: '25 Hz FIFO · 18-bit' },
              { k: 'imu' as const, chip: 'MPU-6886', title: 'Mechanical', body: '6-axis accelerometer and gyroscope for activity, orientation and motion-artefact gating.', spec: '1 000 Hz · ±4 g · ±500 °/s' },
            ].map((s, i) => (
              <Reveal key={s.k} delay={i * 120}>
                <div className="h-full rounded-xl border border-border bg-surface p-6">
                  <div className="flex items-center justify-between"><span className="font-mono text-xs text-muted">{s.chip}</span><span className="font-mono text-[10px] text-muted">{s.spec}</span></div>
                  <Spark kind={s.k} />
                  <h3 className="mt-3 text-lg font-semibold">{s.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal><p className="mt-6 text-xs text-muted">Also on the board, not yet in the firmware: MAX30205 skin temperature, MAX17048 fuel gauge, SSD1306 display. The platform shows these as <span className="text-foreground">Not available</span> rather than guessing.</p></Reveal>
        </section>

        {/* 02 PROCESSING */}
        <section id="processing" className="relative scroll-mt-20 border-y border-border bg-surface/40 py-28">
          <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 lg:grid-cols-2">
            <div>
              <Reveal><Eyebrow n="02">Processing</Eyebrow></Reveal>
              <Reveal delay={80}><h2 className="mt-5 text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">The CPU never waits for a sensor.</h2></Reveal>
              <Reveal delay={160}><p className="mt-5 text-muted leading-relaxed">An STM32G431 at 170 MHz runs the acquisition entirely on DMA and interrupts. Sensor data lands in single-producer rings, gets batched by the main loop and framed for the radio. About 18.5 kB/s leaves the board at the default configuration.</p></Reveal>
            </div>
            <Reveal delay={120}>
              <div className="rounded-xl border border-border bg-background p-6 font-mono text-xs">
                {[['ADC2 ← TIM2 TRGO', 'ECG', 'text-ecg'], ['I²C1 DMA ← A_FULL', 'PPG', 'text-ppg-ir'], ['FIFO drain / 5 ms', 'IMU', 'text-imu-x']].map(([src, k, c], i) => (
                  <div key={k} className="flex items-center gap-3 py-2.5">
                    <span className={cn('w-10 font-semibold', c)}>{k}</span>
                    <span className="w-36 text-muted">{src}</span>
                    <span className="relative h-px flex-1 overflow-hidden bg-border">
                      <span className={cn('landing-packet absolute top-[-2px] h-[5px] w-6 rounded-full bg-current', c)} style={{ animationDelay: `${i * 0.4}s` }} />
                    </span>
                    <span className="rounded border border-border px-2 py-1 text-muted">ring</span>
                  </div>
                ))}
                <div className="mt-3 flex items-center gap-3 border-t border-border pt-4">
                  <Cpu className="h-4 w-4 text-primary" /><span className="text-muted">main loop → batch → frame → USART1 @ 1 Mbaud, RTS/CTS</span>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* 03 CONNECTION */}
        <section id="connection" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-28">
          <Reveal><Eyebrow n="03">Connection</Eyebrow></Reveal>
          <Reveal delay={80}><h2 className="mt-5 max-w-3xl text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">Twenty-one bytes, read straight from the firmware.</h2></Reveal>
          <Reveal delay={160}><p className="mt-5 max-w-2xl text-muted leading-relaxed">This is a real ECG frame, captured by compiling the firmware’s own framing code on a host. An nRF52840 bridges the wired link to Bluetooth LE (Nordic UART Service). The platform’s decoders are tested byte for byte against these captures. Select a field.</p></Reveal>
          <Reveal delay={200} className="mt-10"><FrameAnatomy /></Reveal>
          <Reveal delay={240}>
            <div className="mt-8 flex flex-wrap items-center gap-3 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1"><Cpu className="h-3.5 w-3.5" />STM32G431</span>→
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1"><Radio className="h-3.5 w-3.5" />UART 1 Mbaud</span>→
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1"><Bluetooth className="h-3.5 w-3.5" />nRF52840 · NUS</span>→
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1"><Waves className="h-3.5 w-3.5" />Gateway</span>
            </div>
          </Reveal>
        </section>

        {/* 04 PLATFORM */}
        <section id="platform" className="scroll-mt-20 border-y border-border bg-surface/40 py-28">
          <div className="mx-auto max-w-6xl px-5">
            <Reveal><Eyebrow n="04">Platform</Eyebrow></Reveal>
            <Reveal delay={80}><h2 className="mt-5 max-w-3xl text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">Nine steps between a radio packet and your screen.</h2></Reveal>
            <Reveal delay={120}><p className="mt-5 max-w-2xl text-muted leading-relaxed">Real hardware, recorded sessions and the simulator all enter at step one. There is exactly one path.</p></Reveal>
            <ol className="mt-12 grid gap-2 sm:grid-cols-3 lg:grid-cols-9">
              {PIPELINE.map(([name, desc], i) => (
                <li key={name} className={cn('rounded-lg border p-4 transition-colors duration-500 lg:min-h-[148px]', i === active ? 'border-primary/60 bg-primary/10' : 'border-border bg-background')}>
                  <div className="font-mono text-[10px] text-muted">{String(i + 1).padStart(2, '0')}</div>
                  <div className={cn('mt-1 text-sm font-semibold', i === active && 'text-primary')}>{name}</div>
                  <div className="mt-1.5 text-[11px] leading-snug text-muted">{desc}</div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 05 EXPERIENCE */}
        <section className="mx-auto max-w-6xl px-5 py-28">
          <Reveal><Eyebrow n="05">Experience</Eyebrow></Reveal>
          <Reveal delay={80}><h2 className="mt-5 max-w-3xl text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">Honest about what it knows. And what it doesn’t.</h2></Reveal>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              ['Six states, never ambiguous', 'LIVE, STALE, DISCONNECTED, LOADING, ERROR, NO DATA. Stale numbers dim; missing values say why.'],
              ['Withheld beats wrong', 'When the wrist moves too much for optical pulse, the SpO₂ estimate is withheld instead of drifting to the arm-swing cadence.'],
              ['Events you can follow', 'Every alert links to the exact second on the sensor timeline, can be acknowledged with a note, and is audit-logged.'],
            ].map(([t, b], i) => (
              <Reveal key={t} delay={i * 120}><div className="h-full rounded-xl border border-border bg-surface p-6"><h3 className="font-semibold">{t}</h3><p className="mt-2 text-sm leading-relaxed text-muted">{b}</p></div></Reveal>
            ))}
          </div>
        </section>

        {/* 06 DATA */}
        <section id="data" className="scroll-mt-20 border-y border-border bg-surface/40 py-28">
          <div className="mx-auto max-w-6xl px-5">
            <Reveal><Eyebrow n="06">Data</Eyebrow></Reveal>
            <Reveal delay={80}><h2 className="mt-5 max-w-3xl text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">Numbers with receipts.</h2></Reveal>
            <div className="mt-12 grid gap-4 lg:grid-cols-2">
              <Reveal>
                <div className="h-full rounded-xl border border-border bg-background p-6">
                  <div className="text-xs font-semibold uppercase tracking-wider text-ok">Verified in this repository</div>
                  <ul className="mt-4 space-y-3 text-sm">
                    {[['Byte-exact', 'Python and TypeScript decoders match frames produced by the firmware’s own nrf_link.c'],
                      ['257 frames/s', 'at the default configuration (200 IMU + ~31 ECG + 25 PPG + 1 stats frame per second), from the firmware’s batching rules'],
                      ['10 scenarios', 'deterministic, seeded, each asserting the events it should raise'],
                      ['Exact loss accounting', 'injected packet loss equals the loss counted from sequence gaps, in tests']].map(([k, v]) => (
                      <li key={k} className="flex gap-3"><span className="w-36 shrink-0 font-mono text-primary">{k}</span><span className="text-muted">{v}</span></li>
                    ))}
                  </ul>
                </div>
              </Reveal>
              <Reveal delay={120}>
                <div className="h-full rounded-xl border border-border bg-background p-6">
                  <div className="text-xs font-semibold uppercase tracking-wider text-warning">Not yet measured</div>
                  <ul className="mt-4 space-y-3 text-sm text-muted">
                    {['Clinical accuracy of heart rate, SpO₂ or rhythm flags (needs a reference device and a study)', 'Fall-detection sensitivity and specificity',
                      'BLE range, throughput and real-world packet loss on the hardware', 'Battery life (fuel-gauge driver not implemented)', 'End-to-end latency including the radio'].map((x) => (
                      <li key={x} className="flex gap-3"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-warning" />{x}</li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* 07 SYSTEM */}
        <section id="system" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-28">
          <Reveal><Eyebrow n="07">System</Eyebrow></Reveal>
          <Reveal delay={80}><h2 className="mt-5 max-w-3xl text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">From silicon to screen, in one repository.</h2></Reveal>
          <Reveal delay={160}>
            <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[
                [Cpu, 'Wristband', 'STM32G431 · C · DMA'], [Bluetooth, 'BLE bridge', 'nRF52840 · NUS'], [Radio, 'Gateway', 'Python · BLE/serial/replay/sim'],
                [Database, 'API + store', 'FastAPI · PostgreSQL'], [Waves, 'Console', 'React · TypeScript · Canvas'],
              ].map(([Icon, t, s], i) => {
                const I = Icon as typeof Cpu
                return (
                  <div key={t as string} className="relative rounded-xl border border-border bg-surface p-5">
                    <I className="h-5 w-5 text-primary" aria-hidden />
                    <div className="mt-3 font-semibold">{t as string}</div>
                    <div className="mt-1 font-mono text-[11px] text-muted">{s as string}</div>
                    {i < 4 && <ArrowRight className="absolute -right-3 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-muted lg:block" aria-hidden />}
                  </div>
                )
              })}
            </div>
          </Reveal>
          <Reveal delay={200}>
            <div className="mt-16 flex flex-col items-start gap-6 rounded-2xl border border-primary/30 bg-[radial-gradient(80%_120%_at_0%_0%,hsl(var(--primary)/.14),transparent_60%)] p-8 sm:flex-row sm:items-center sm:p-10">
              <div className="flex-1">
                <h3 className="text-2xl font-semibold tracking-tight">See the pipeline run.</h3>
                <p className="mt-2 text-sm text-muted">Ten scenarios, from a resting heartbeat to a fall, a dropped link and corrupted packets.</p>
              </div>
              <Link to={token ? '/app/demo' : '/login'} className="inline-flex h-12 items-center gap-2 rounded-md bg-primary px-6 font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                Open the demo <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-start">
          <div className="max-w-xl">
            <Logo />
            <p className="mt-4 text-[11px] leading-relaxed text-muted">{DISCLAIMER}</p>
          </div>
          <div className="flex gap-4 text-xs text-muted sm:ml-auto">
            <a href="https://github.com/siddhaantxsingh" className="inline-flex items-center gap-1.5 hover:text-foreground"><Github className="h-4 w-4" />GitHub</a>
            <Link to="/login" className="hover:text-foreground">Console</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
