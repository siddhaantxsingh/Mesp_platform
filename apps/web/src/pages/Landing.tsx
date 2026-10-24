import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import * as D from '@radix-ui/react-dialog'
import {
  Activity, ArrowRight, ArrowUpRight, BellRing, Bluetooth, Cable, Cpu, Database, Github, Loader2, Menu, MonitorSmartphone,
  Pause, Play, Radio, ShieldCheck, Waves, X,
} from 'lucide-react'
import { DISCLAIMER } from '@mesp/types'
import { HeroPlanes } from '@/components/landing/HeroPlanes'
import { useMotion } from '@/components/landing/motion'
import { SignalDeck, SweepLine } from '@/components/landing/SignalDeck'
import { Logo } from '@/components/Logo'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn, prefersReducedMotion } from '@/lib/utils'

const REPO = 'https://github.com/siddhaantxsingh/mesp_platform'
const SECTIONS = [['signal', 'Signal'], ['processing', 'Processing'], ['connection', 'Connection'], ['platform', 'Platform'], ['data', 'Data'], ['system', 'System']] as const
const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
const btnPrimary = cn('inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(168_66%_54%)] font-semibold text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,.35),0_10px_34px_-12px_hsl(var(--primary))] transition hover:-translate-y-0.5 hover:brightness-110 disabled:opacity-70', focusRing)
const btnGhost = cn('inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-surface/60 font-medium transition hover:-translate-y-0.5 hover:border-primary/40 hover:bg-surface-2', focusRing)

/* ------------------------------------------------------------------ helpers */
function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(prefersReducedMotion())
  useEffect(() => {
    if (shown || !ref.current) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect() } }, { rootMargin: '0px 0px -10% 0px' })
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

function Eyebrow({ n, children }: { n?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 font-mono text-xs uppercase tracking-[0.2em] text-primary">
      {n && <span className="text-muted">{n}</span>}<span className="h-px w-8 bg-primary/60" aria-hidden />{children}
    </div>
  )
}

function Section({ id, n, eyebrow, title, intro, shaded, children }: {
  id?: string; n: string; eyebrow: string; title: ReactNode; intro?: ReactNode; shaded?: boolean; children?: ReactNode
}) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={cn('scroll-mt-20 py-20 sm:py-28', shaded && 'border-y border-border bg-surface/50')}>
      <div className="mx-auto max-w-6xl px-5">
        <Reveal><Eyebrow n={n}>{eyebrow}</Eyebrow></Reveal>
        <Reveal delay={80}><h2 id={id ? `${id}-title` : undefined} className="mt-5 max-w-3xl text-[2.1rem] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-5xl">{title}</h2></Reveal>
        {intro && <Reveal delay={140}><p className="mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">{intro}</p></Reveal>}
        {children}
      </div>
    </section>
  )
}

/** "Try the live demo": signs in to the demo straight away (falls back to the sign-in page). */
function useDemo() {
  const nav = useNavigate()
  const token = useAuth((s) => s.token)
  const setToken = useAuth((s) => s.setToken)
  const [busy, setBusy] = useState(false)
  const go = async () => {
    if (token) { nav('/app/live'); return }
    setBusy(true)
    try { setToken(await api.demoLogin()); nav('/app/live') } catch { nav('/login') } finally { setBusy(false) }
  }
  return { go, busy, signedIn: !!token }
}

function MotionToggle({ className }: { className?: string }) {
  const { paused, toggle } = useMotion()
  return (
    <button type="button" onClick={toggle} aria-pressed={paused}
      className={cn('inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-muted hover:text-foreground', focusRing, className)}>
      {paused ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}{paused ? 'Play animations' : 'Pause animations'}
    </button>
  )
}

/* ------------------------------------------------------------------ frame anatomy (real firmware bytes) */
// ECG_RAW frame produced by the firmware's own framing code (packages/protocol/vectors, "ecg_6")
const FRAME_HEX = 'aa550105020c00000008000fff00010abc0bb85a21'
const BYTES = FRAME_HEX.match(/../g)!
const FIELDS = [
  { from: 0, to: 2, name: 'Sync', color: 'text-muted', text: '0xAA 0x55 marks the start of a frame. The decoder finds its place again after noise or a dropped byte.' },
  { from: 2, to: 3, name: 'Version', color: 'text-info', text: 'Protocol version 1. Frames with a version the platform does not speak are counted and dropped, never misread.' },
  { from: 3, to: 4, name: 'Type', color: 'text-ecg', text: '0x05 = ECG_RAW. Others: PPG_RAW 0x01, IMU_RAW 0x02, STATUS 0x03, TEXT 0x04, and EVENT 0x06 for the wristband’s own fall and irregular-rhythm alerts.' },
  { from: 4, to: 5, name: 'Sequence', color: 'text-warning', text: 'One 8-bit counter shared by every frame. Gaps reveal lost packets; repeats reveal duplicates.' },
  { from: 5, to: 7, name: 'Length', color: 'text-info', text: 'Payload length, little-endian (12 bytes here, up to 1008).' },
  { from: 7, to: 19, name: 'Payload', color: 'text-foreground', text: 'Six 12-bit ADC codes, big-endian: 0, 2048, 4095, 1, 2748, 3000. The link carries raw codes; the platform does the maths.' },
  { from: 19, to: 21, name: 'CRC-16', color: 'text-critical', text: 'CRC-16/CCITT-FALSE over version..payload. One flipped bit and the frame is rejected.' },
]

function FrameAnatomy() {
  const [sel, setSel] = useState(5)
  const f = FIELDS[sel]
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex justify-between gap-3 border-b border-border px-5 py-3 font-mono text-xs uppercase tracking-wider text-muted">
        <span>ECG_RAW · protocol v1</span><span>21 bytes</span>
      </div>
      <div className="flex flex-wrap gap-2 p-5 sm:p-7" role="listbox" aria-label="Frame bytes, grouped by field">
        {FIELDS.map((fd, i) => (
          <button key={fd.name} role="option" aria-selected={sel === i} onMouseEnter={() => setSel(i)} onFocus={() => setSel(i)} onClick={() => setSel(i)}
            className={cn('rounded-lg border px-2.5 pb-2 pt-2.5 text-left transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              sel === i ? 'border-primary/60 bg-primary/10' : 'border-border bg-background hover:border-primary/30')}>
            <span className="flex flex-wrap gap-1 font-mono text-sm sm:text-base">
              {BYTES.slice(fd.from, fd.to).map((b, k) => <span key={k} className={cn(fd.color, 'tabular-nums')}>{b.toUpperCase()}</span>)}
            </span>
            <span className="mt-1.5 block text-xs uppercase tracking-wider text-muted">{fd.name}</span>
          </button>
        ))}
      </div>
      <div className="min-h-[96px] border-t border-border bg-background/40 px-5 py-4 sm:px-7" aria-live="polite">
        <div className={cn('text-sm font-semibold uppercase tracking-wider', f.color)}>{f.name}</div>
        <p className="mt-1 text-base leading-relaxed text-muted">{f.text}</p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ page */
const PIPELINE = [
  ['Deframe', 'Byte stream → frames, resync on 0xAA55'], ['Verify', 'CRC-16 on every frame, again on the server'], ['Decode', 'Versioned adapter and device profile'],
  ['Timestamp', 'Per-sample time from nominal rate + host clock'], ['Sequence', '8-bit counter → loss and duplicates'], ['Persist', '1 s chunks in PostgreSQL'],
  ['Derive', 'R-peaks, pulse, SpO₂ estimate, motion, falls'], ['Events', 'Sustained-condition rules with hysteresis'], ['Stream', 'Versioned WebSocket to the browser'],
] as const

export default function Landing() {
  const root = useRef<HTMLDivElement>(null)
  const paused = useMotion((s) => s.paused)
  const demo = useDemo()
  const [menu, setMenu] = useState(false)
  const [active, setActive] = useState(0)
  useEffect(() => {
    if (paused) return
    const id = setInterval(() => setActive((a) => (a + 1) % PIPELINE.length), 1400)
    return () => clearInterval(id)
  }, [paused])

  const demoButton = ({ size = 'lg', label }: { size?: 'sm' | 'lg'; label?: string } = {}) => (
    <button type="button" onClick={demo.go} disabled={demo.busy}
      className={cn(btnPrimary, size === 'lg' ? 'h-12 px-6 text-base' : 'h-10 px-4 text-sm')}>
      {demo.busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {label ?? (demo.signedIn ? 'Open the console' : 'Try the live demo')}<ArrowRight className="h-4 w-4" aria-hidden />
    </button>
  )

  return (
    <div ref={root} className={cn('dark landing-theme min-h-screen overflow-x-hidden bg-background text-foreground', paused && 'motion-paused')}>
      <a href="#story" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">Skip to content</a>

      {/* HEADER */}
      <header className="fixed inset-x-0 top-0 z-40 border-b border-foreground/[.06] bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-5 px-5">
          <a href="#top" className={cn('rounded-md', focusRing)} aria-label="MESP Monitor, back to top"><Logo /></a>
          <nav aria-label="Sections" className="hidden gap-6 text-sm text-muted lg:flex">
            {SECTIONS.map(([id, l]) => <a key={id} href={`#${id}`} className={cn('rounded hover:text-foreground', focusRing)}>{l}</a>)}
          </nav>
          <div className="ml-auto hidden items-center gap-2 lg:flex">
            <MotionToggle />
            {!demo.signedIn && <Link to="/login" className={cn(btnGhost, 'h-10 px-4 text-sm')}>Sign in</Link>}
            {demoButton({size: 'sm'})}
          </div>
          <div className="ml-auto flex items-center gap-2 lg:hidden">
            {demoButton({size: 'sm', label: demo.signedIn ? 'Console' : 'Live demo'})}
            <D.Root open={menu} onOpenChange={setMenu}>
              <D.Trigger className={cn('inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border text-foreground', focusRing)} aria-label="Open menu">
                <Menu className="h-5 w-5" aria-hidden />
              </D.Trigger>
              <D.Portal container={root.current}>
                <D.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
                <D.Content className="fixed inset-x-3 top-3 z-50 rounded-2xl border border-border bg-surface p-5 shadow-2xl focus:outline-none">
                  <div className="flex items-center justify-between">
                    <D.Title className="text-base font-semibold">Menu</D.Title>
                    <D.Close className={cn('inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:text-foreground', focusRing)} aria-label="Close menu"><X className="h-5 w-5" /></D.Close>
                  </div>
                  <D.Description className="sr-only">Jump to a section or sign in</D.Description>
                  <nav aria-label="Sections" className="mt-3 grid grid-cols-2 gap-2">
                    {SECTIONS.map(([id, l]) => (
                      <a key={id} href={`#${id}`} onClick={() => setMenu(false)} className={cn('rounded-lg border border-border px-4 py-3 text-base hover:border-primary/40', focusRing)}>{l}</a>
                    ))}
                  </nav>
                  <div className="mt-4 grid gap-2">
                    {!demo.signedIn && <Link to="/login" className={cn(btnGhost, 'h-12 text-base')}>Sign in</Link>}
                    <MotionToggle className="h-12 justify-center text-base" />
                  </div>
                </D.Content>
              </D.Portal>
            </D.Root>
          </div>
        </div>
      </header>

      <main id="story">
      {/* HERO */}
      <section id="top" className="relative isolate overflow-hidden pt-16">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(55%_60%_at_78%_45%,hsl(var(--primary)/.13),transparent_65%)]" aria-hidden />
        <SweepLine className="absolute inset-x-0 top-16 -z-10 h-24 w-full opacity-70 [mask-image:linear-gradient(90deg,transparent,black_18%,black_82%,transparent)]" />
        <div className="mx-auto grid max-w-6xl items-center gap-6 px-5 pb-14 pt-28 lg:min-h-[calc(100svh-4rem)] lg:grid-cols-[1fr_1fr] lg:gap-4 lg:pb-16 lg:pt-12">
          <div className="landing-enter">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/70 px-3.5 py-1.5 text-sm text-muted backdrop-blur">
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />Engineering prototype · not a medical device
            </div>
            <h1 className="mt-6 text-[clamp(2.7rem,5.6vw,5rem)] font-semibold leading-[0.98] tracking-[-0.045em]">
              Three sensors.<br /><span className="text-muted">One wrist.</span>
            </h1>
            <p className="mt-4 text-[clamp(1.4rem,2.6vw,2rem)] font-medium leading-tight tracking-[-0.02em] text-primary">Every byte accounted for.</p>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
              MESP streams ECG, optical pulse and motion from an STM32 wristband into a real-time platform — by Bluetooth or a USB cable,
              straight from your browser. Every frame is checked, timed, sequenced and stored.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {demoButton({})}
              <Link to={demo.signedIn ? '/app/live' : '/login'} className={cn(btnGhost, 'h-12 px-6 text-base')}>
                <Bluetooth className="h-4 w-4 text-primary" aria-hidden />Connect your wristband
              </Link>
            </div>
            <p className="mt-4 text-sm text-muted">The demo needs no account and uses clearly labelled synthetic data.</p>
          </div>
          <HeroPlanes />
        </div>
      </section>

      {/* RIBBON */}
      <div className="border-y border-border bg-gradient-to-r from-background via-surface to-background">
        <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-x-6 gap-y-5 px-5 py-7 lg:grid-cols-4">
          {[['3 sensors', 'ECG, optical pulse and motion'], ['CRC-16', 'checked on every frame, twice'], ['257 frames/s', '18.5 kB/s from the wristband'], ['150 tests', 'from firmware bytes to browser']].map(([k, v]) => (
            <div key={k} className="lg:border-r lg:border-border lg:last:border-0">
              <dt className="text-lg font-semibold tracking-tight text-foreground">{k}</dt>
              <dd className="mt-0.5 text-sm text-muted">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

        {/* STATEMENT */}
        <section className="mx-auto max-w-6xl px-5 pb-4 pt-20 sm:pt-28" aria-label="The MESP principle">
          <Reveal><Eyebrow>The MESP principle</Eyebrow></Reveal>
          <Reveal delay={80}>
            <p className="mt-6 max-w-4xl text-[clamp(1.9rem,4.2vw,3.3rem)] font-medium leading-[1.15] tracking-[-0.03em]">
              A signal is only as useful as your ability to <span className="text-primary">understand it — and to trust it.</span>
            </p>
          </Reveal>
        </section>

        {/* 01 SIGNAL */}
        <Section id="signal" n="01" eyebrow="Signal" title="Every signal has a story."
          intro="Electrical activity, optical pulse and movement: three views of the same wrist, designed to be read together.">
          <Reveal delay={160}><SignalDeck /></Reveal>
          <Reveal><p className="mt-6 text-sm leading-relaxed text-muted">Also on the board, not yet in the firmware: MAX30205 skin temperature, MAX17048 fuel gauge, SSD1306 display. The platform shows these as <span className="text-foreground">Not available</span> rather than guessing.</p></Reveal>
        </Section>

        {/* 02 PROCESSING */}
        <section id="processing" aria-labelledby="processing-title" className="scroll-mt-20 border-y border-border bg-surface/50 py-20 sm:py-28">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 lg:grid-cols-2 lg:gap-16">
            <div>
              <Reveal><Eyebrow n="02">Processing</Eyebrow></Reveal>
              <Reveal delay={80}><h2 id="processing-title" className="mt-5 text-[2.1rem] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-5xl">The CPU never waits for a sensor.</h2></Reveal>
              <Reveal delay={160}><p className="mt-5 text-base leading-relaxed text-muted sm:text-lg">An STM32G431 at 170 MHz runs the acquisition entirely on DMA and interrupts. Sensor data lands in single-producer rings, gets batched by the main loop and framed for the radio. About 18.5 kB/s leaves the board at the default configuration.</p></Reveal>
              <Reveal delay={200}><p className="mt-4 text-sm text-muted">The moving packets illustrate the architecture, not measured timing.</p></Reveal>
            </div>
            <Reveal delay={120}>
              <div className="rounded-2xl border border-border bg-[radial-gradient(ellipse_at_50%_100%,hsl(var(--primary)/.10),transparent_75%)] bg-background p-5 font-mono text-sm sm:p-6">
                {[['ADC2 ← TIM2 TRGO', 'ECG', 'text-ecg'], ['I²C1 DMA ← A_FULL', 'PPG', 'text-ppg-ir'], ['FIFO drain / 5 ms', 'IMU', 'text-imu-x']].map(([src, k, c], i) => (
                  <div key={k} className="flex items-center gap-3 py-3">
                    <span className={cn('w-10 font-semibold', c)}>{k}</span>
                    <span className="hidden w-40 text-muted sm:block">{src}</span>
                    <span className="relative h-px flex-1 overflow-hidden bg-border" aria-hidden>
                      <span className={cn('landing-packet absolute top-[-2px] h-[5px] w-6 rounded-full bg-current', c)} style={{ animationDelay: `${i * 0.4}s` }} />
                    </span>
                    <span className="rounded-md border border-border px-2 py-1 text-xs text-muted">ring buffer</span>
                  </div>
                ))}
                <div className="mt-4 flex items-center gap-4 rounded-xl border border-primary/25 bg-primary/[.06] p-4">
                  <div className="whitespace-nowrap font-sans text-3xl font-semibold tracking-tight sm:text-4xl">170<span className="ml-1 text-sm font-normal text-muted">MHz</span></div>
                  <div className="border-l border-border pl-4">
                    <div className="flex items-center gap-1.5 font-sans font-semibold"><Cpu className="h-4 w-4 text-primary" aria-hidden />STM32G431</div>
                    <div className="mt-1 text-xs leading-relaxed text-muted">main loop → batch → frame → USART1 @ 1 Mbaud, RTS/CTS</div>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* 03 CONNECTION */}
        <Section id="connection" n="03" eyebrow="Connection" title="Twenty-one bytes, read straight from the firmware."
          intro="This is a real ECG frame, captured by compiling the firmware’s own framing code on a host. The platform’s decoders are tested byte for byte against these captures. Select a field.">
          <Reveal delay={180} className="mt-10"><FrameAnatomy /></Reveal>
          <Reveal delay={120}>
            <h3 className="mt-16 text-2xl font-semibold tracking-tight">Three ways in, one pipeline.</h3>
            <p className="mt-2 max-w-2xl text-base text-muted">The nRF52840 forwards the wristband’s bytes unchanged — over Bluetooth LE (Nordic UART Service) and its USB port at the same time.</p>
          </Reveal>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {[
              [Bluetooth, 'Bluetooth, from the browser', 'Press Connect by Bluetooth on the Live page and pick “MESP-Health”. Chrome or Edge on Windows, macOS, Linux and Android.'],
              [Cable, 'USB cable, from the browser', 'Plug the cable into the nRF board and press Connect by USB cable. Skips the radio entirely — ideal on the bench.'],
              [Radio, 'Gateway program', 'A Python gateway for always-on machines: Bluetooth, serial, recorded sessions and the simulator.'],
            ].map(([Icon, t, b], i) => {
              const I = Icon as typeof Cpu
              return (
                <Reveal key={t as string} delay={i * 100}>
                  <div className="h-full rounded-2xl border border-border bg-surface p-6 transition hover:-translate-y-1 hover:border-primary/40">
                    <I className="h-5 w-5 text-primary" aria-hidden />
                    <h4 className="mt-4 text-lg font-semibold">{t as string}</h4>
                    <p className="mt-2 text-base leading-relaxed text-muted">{b as string}</p>
                  </div>
                </Reveal>
              )
            })}
          </div>
          <Reveal><p className="mt-5 text-sm text-muted">Every route ends at the same server, which checks every frame’s CRC again. Only one connection per wristband at a time.</p></Reveal>
        </Section>

        {/* 04 PLATFORM */}
        <Section id="platform" n="04" eyebrow="Platform" shaded title="Nine steps between a radio packet and your screen."
          intro="Real hardware, recorded sessions and the simulator all enter at step one. There is exactly one path.">
          <ol className="mt-12 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-9">
            {PIPELINE.map(([name, desc], i) => (
              <li key={name} aria-current={i === active ? 'step' : undefined}
                className={cn('rounded-xl border p-4 transition-colors duration-500 lg:min-h-[168px]', i === active ? 'border-primary/60 bg-primary/10' : 'border-border bg-background')}>
                <div className="font-mono text-xs text-muted">{String(i + 1).padStart(2, '0')}</div>
                <div className={cn('mt-1 text-base font-semibold', i === active && 'text-primary')}>{name}</div>
                <div className="mt-1.5 text-xs leading-snug text-muted">{desc}</div>
              </li>
            ))}
          </ol>
        </Section>

        {/* 05 EXPERIENCE */}
        <Section n="05" eyebrow="Experience" title="Honest about what it knows. And what it doesn’t.">
          <div className="mt-12 grid gap-4 md:grid-cols-2">
            {[
              [Activity, 'Six states, never ambiguous', 'LIVE, STALE, DISCONNECTED, LOADING, ERROR, NO DATA. Stale numbers dim; missing values say why.'],
              [Waves, 'Withheld beats wrong', 'When the wrist moves too much for optical pulse, the SpO₂ estimate is withheld instead of drifting to the arm-swing cadence.'],
              [BellRing, 'Alerts from the wristband itself', 'The band’s own fall detector and irregular-rhythm (AFib pattern) screen arrive as alerts with their evidence. Screening only, never a diagnosis.'],
              [MonitorSmartphone, 'Events you can follow', 'Every alert links to the exact second on the sensor timeline, can be acknowledged with a note, and is audit-logged.'],
            ].map(([Icon, t, b], i) => {
              const I = Icon as typeof Cpu
              return (
                <Reveal key={t as string} delay={(i % 2) * 120}>
                  <div className="h-full rounded-2xl border border-border bg-surface p-6">
                    <I className="h-5 w-5 text-primary" aria-hidden />
                    <h3 className="mt-4 text-lg font-semibold">{t as string}</h3>
                    <p className="mt-2 text-base leading-relaxed text-muted">{b as string}</p>
                  </div>
                </Reveal>
              )
            })}
          </div>
        </Section>

        {/* 06 DATA */}
        <Section id="data" n="06" eyebrow="Data" shaded title="Numbers with receipts."
          intro="Missing values stay missing. Estimates stay labelled. Synthetic data never pretends to be a measurement.">
          <div className="mt-12 grid gap-4 lg:grid-cols-2">
            <Reveal>
              <div className="h-full rounded-2xl border border-border bg-background p-6">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-ok">Verified in this repository</h3>
                <ul className="mt-4 space-y-4 text-base">
                  {[['Byte-exact', 'Python and TypeScript decoders match 12 frames produced by the firmware’s own nrf_link.c, including the wristband’s alert frames'],
                    ['257 frames/s', 'at the default configuration (200 IMU + ~31 ECG + 25 PPG + 1 stats frame per second), from the firmware’s batching rules'],
                    ['10 scenarios', 'deterministic, seeded, each asserting the events it should raise'],
                    ['Exact loss accounting', 'injected packet loss equals the loss counted from sequence gaps, in tests'],
                    ['150 tests', 'across firmware vectors, server, gateway, browser connection and accessibility checks']].map(([k, v]) => (
                    <li key={k} className="flex flex-col gap-1 sm:flex-row sm:gap-4"><span className="shrink-0 font-mono text-primary sm:w-44">{k}</span><span className="text-muted">{v}</span></li>
                  ))}
                </ul>
              </div>
            </Reveal>
            <Reveal delay={120}>
              <div className="h-full rounded-2xl border border-border bg-background p-6">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-warning">Not yet measured</h3>
                <ul className="mt-4 space-y-3 text-base text-muted">
                  {['Clinical accuracy of heart rate, SpO₂ or rhythm flags (needs a reference device and a study)', 'Fall-detection sensitivity and specificity',
                    'Bluetooth range, throughput and real-world packet loss on the hardware', 'Battery life (fuel-gauge driver not implemented)', 'End-to-end latency including the radio'].map((x) => (
                    <li key={x} className="flex gap-3"><span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden />{x}</li>
                  ))}
                </ul>
              </div>
            </Reveal>
          </div>
        </Section>

        {/* 07 SYSTEM */}
        <Section id="system" n="07" eyebrow="System" title="From silicon to screen, in one repository.">
          <Reveal delay={140}>
            <ol className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[
                [Cpu, 'Wristband', 'STM32G431 · C · DMA'], [Bluetooth, 'nRF bridge', 'nRF52840 · BLE + USB'], [MonitorSmartphone, 'Browser or gateway', 'Web Bluetooth · Web Serial · Python'],
                [Database, 'API + store', 'FastAPI · PostgreSQL'], [Waves, 'Console', 'React · TypeScript · Canvas'],
              ].map(([Icon, t, s], i) => {
                const I = Icon as typeof Cpu
                return (
                  <li key={t as string} className="relative rounded-2xl border border-border bg-surface p-5 transition hover:-translate-y-1 hover:border-primary/40">
                    <I className="h-5 w-5 text-primary" aria-hidden />
                    <div className="mt-3 text-base font-semibold">{t as string}</div>
                    <div className="mt-1 font-mono text-xs text-muted">{s as string}</div>
                    {i < 4 && <ArrowRight className="absolute -right-3 top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 text-muted lg:block" aria-hidden />}
                  </li>
                )
              })}
            </ol>
          </Reveal>
        </Section>

        {/* ENDING */}
        <section className="relative overflow-hidden border-t border-border px-5 py-24 text-center sm:py-32" aria-labelledby="end-title">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_100%,hsl(var(--primary)/.14),transparent_65%)]" aria-hidden />
          <SweepLine sweep={false} className="absolute inset-x-0 top-1/2 h-40 w-full -translate-y-1/2 opacity-60" />
          <Reveal className="relative">
            <div className="flex justify-center"><Eyebrow>Follow the signal</Eyebrow></div>
            <h2 id="end-title" className="mx-auto mt-6 max-w-3xl text-[clamp(2.4rem,6vw,4.6rem)] font-semibold leading-[1.05] tracking-[-0.04em]">See it come alive.</h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-muted sm:text-lg">Run ten scenarios — from a resting heartbeat to a fall, a dropped link and corrupted packets — or connect your own wristband.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              {demoButton({})}
              <a href={REPO} className={cn(btnGhost, 'h-12 px-6 text-base')}><Github className="h-4 w-4" aria-hidden />View the code<ArrowUpRight className="h-4 w-4" aria-hidden /></a>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-start">
          <div className="max-w-xl">
            <Logo />
            <p className="mt-4 text-sm leading-relaxed text-muted">{DISCLAIMER}</p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted sm:ml-auto">
            <a href={REPO} className={cn('inline-flex items-center gap-1.5 rounded hover:text-foreground', focusRing)}><Github className="h-4 w-4" aria-hidden />GitHub</a>
            <Link to="/login" className={cn('rounded hover:text-foreground', focusRing)}>Sign in</Link>
            <button type="button" onClick={demo.go} className={cn('rounded hover:text-foreground', focusRing)}>Live demo</button>
          </nav>
        </div>
      </footer>
    </div>
  )
}
