import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { signal, tokenColor, useCanvas, useMotion, type SignalKind } from './motion'

const LAYERS: { kind: SignalKind; name: string; sub: string }[] = [
  { kind: 'ecg', name: 'ECG', sub: 'Electrical activity' },
  { kind: 'ppg', name: 'PPG', sub: 'Optical pulse' },
  { kind: 'imu', name: 'IMU', sub: 'Motion context' },
]

/** Three floating "signal planes" (ECG, PPG, IMU). Illustrative only — never real data. */
export function HeroPlanes() {
  const [focus, setFocus] = useState(-1)
  const weights = useRef([1, 1, 1])
  const target = useRef({ x: 0, y: 0 })
  const tilt = useRef({ x: 0, y: 0 })
  const paused = useMotion((s) => s.paused)

  const { ref, kick } = useCanvas((ctx, w, h, t) => {
    const el = ref.current!
    const primary = tokenColor(el, '--primary'), fg = tokenColor(el, '--foreground'), muted = tokenColor(el, '--muted')
    const ppg = tokenColor(el, '--signal-ppg-ir'), imuY = tokenColor(el, '--signal-imu-y'), imuX = tokenColor(el, '--signal-imu-x')
    tilt.current.x += (target.current.x - tilt.current.x) * (paused ? 1 : 0.06)
    tilt.current.y += (target.current.y - tilt.current.y) * (paused ? 1 : 0.06)
    const { x: mx, y: my } = tilt.current
    ctx.save()
    const s = Math.min(w / 760, h / 540)
    ctx.translate((w - 760 * s) / 2, (h - 540 * s) / 2)
    ctx.scale(s, s)
    const P = (u: number, v: number, k: number): [number, number] => [
      38 + u * 445 + v * 148 + mx * (k + 1) * 0.3,
      157 + k * 126 - u * 103 + v * 86 + Math.sin(t * 0.48 - k * 1.1) * 4 + my * (k + 1) * 0.3,
    ]
    let moving = false
    for (let k = 2; k >= 0; k--) {
      const goal = focus < 0 || focus === k ? 1 : 0.2
      const cur = weights.current[k]
      weights.current[k] = paused ? goal : cur + (goal - cur) * 0.12
      if (Math.abs(weights.current[k] - goal) > 0.003) moving = true
      const op = weights.current[k]
      const corners = [P(0, 0, k), P(1, 0, k), P(1, 1, k), P(0, 1, k)]
      const poly = (dy = 0) => { ctx.beginPath(); corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y + dy) : ctx.moveTo(x, y + dy))); ctx.closePath() }

      ctx.globalAlpha = op
      ctx.save(); poly(6); ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.shadowColor = '#000'; ctx.shadowBlur = 26; ctx.shadowOffsetY = 16; ctx.fill(); ctx.restore()
      const surf = ctx.createLinearGradient(40, 50 + k * 126, 630, 260 + k * 126)
      surf.addColorStop(0, primary(0.13)); surf.addColorStop(0.45, primary(0.09)); surf.addColorStop(1, primary(0.03))
      poly(); ctx.fillStyle = surf; ctx.fill()
      const edge = ctx.createLinearGradient(40, 100, 640, 400)
      edge.addColorStop(0, primary(0.15)); edge.addColorStop(0.5, primary(0.5)); edge.addColorStop(1, primary(0.18))
      ctx.strokeStyle = edge; ctx.lineWidth = 0.8; ctx.stroke()

      ctx.save(); poly(); ctx.clip()
      ctx.strokeStyle = fg(0.05); ctx.lineWidth = 0.55; ctx.beginPath()
      for (let i = 0; i <= 26; i++) { ctx.moveTo(...P(i / 26, 0, k)); ctx.lineTo(...P(i / 26, 1, k)) }
      for (let j = 0; j <= 9; j++) { ctx.moveTo(...P(0, j / 9, k)); ctx.lineTo(...P(1, j / 9, k)) }
      ctx.stroke()
      const sw = ((t * 0.065 + k * 0.25) % 1.3) - 0.15
      ctx.beginPath(); ctx.moveTo(...P(sw, 0, k)); ctx.lineTo(...P(sw, 1, k)); ctx.strokeStyle = primary(0.2); ctx.lineWidth = 0.9; ctx.stroke()
      ctx.restore()

      const kind = LAYERS[k].kind
      const line = (ch: number, glow: boolean) => {
        ctx.beginPath()
        for (let i = 0; i <= 300; i++) {
          const u = i / 300, p = P(u, 0.59 + ch * 0.16, k)
          p[1] -= signal(kind, u * 4.15 + t * 0.235, ch) * (k === 2 ? 64 : 70)
          i ? ctx.lineTo(...p) : ctx.moveTo(...p)
        }
        const col = k === 1 ? ppg : k === 2 ? [imuX, imuY, muted][ch] : primary
        ctx.strokeStyle = col(glow ? 0.16 : ch ? 0.75 : 1)
        ctx.lineWidth = glow ? 5 : ch ? 1 : 1.6
        ctx.stroke()
      }
      line(0, true); line(0, false)
      if (k === 2) { line(1, false); line(2, false) }

      const head = (t * 0.09 + k * 0.27) % 1, hp = P(head, 0.59, k)
      hp[1] -= signal(kind, head * 4.15 + t * 0.235) * (k === 2 ? 64 : 70)
      const g = ctx.createRadialGradient(hp[0], hp[1], 0, hp[0], hp[1], 19)
      g.addColorStop(0, primary(0.5)); g.addColorStop(1, primary(0))
      ctx.fillStyle = g; ctx.fillRect(hp[0] - 19, hp[1] - 19, 38, 38)

      const lb = P(1, 0.74, k)
      ctx.beginPath(); ctx.moveTo(lb[0] + 8, lb[1]); ctx.lineTo(lb[0] + 30, lb[1]); ctx.strokeStyle = primary(0.6); ctx.lineWidth = 0.7; ctx.stroke()
      // labels never render below 12 px on screen; on small screens only the short name fits
      ctx.fillStyle = fg(0.95); ctx.font = `600 ${Math.max(15, 12.5 / s)}px Inter Variable, system-ui, sans-serif`
      ctx.fillText(LAYERS[k].name, lb[0] + 40, lb[1] + 5)
      if (s >= 0.85) {
        ctx.fillStyle = muted(1); ctx.font = `${Math.max(13, 12 / s)}px Inter Variable, system-ui, sans-serif`
        ctx.fillText(LAYERS[k].sub, lb[0] + 40, lb[1] + 24)
      }
    }
    ctx.globalAlpha = 1
    ctx.restore()
    if (moving && paused) requestAnimationFrame(kick)
  }, [focus])

  const label = focus < 0
    ? 'Illustration: three floating planes showing animated ECG, optical pulse and motion waveforms. Not real data.'
    : `Illustration focused on the ${LAYERS[focus].name} layer (${LAYERS[focus].sub.toLowerCase()}). Not real data.`

  return (
    <figure className="relative m-0">
      <div
        className="relative h-[300px] sm:h-[420px] lg:h-[540px] lg:w-[118%] lg:-ml-[6%]"
        onPointerMove={(e) => {
          if (paused || e.pointerType === 'touch') return
          const r = e.currentTarget.getBoundingClientRect()
          target.current = { x: ((e.clientX - r.left) / r.width - 0.5) * 10, y: ((e.clientY - r.top) / r.height - 0.5) * 6 }
          kick()
        }}
        onPointerLeave={() => { target.current = { x: 0, y: 0 }; kick() }}>
        <canvas ref={ref} role="img" aria-label={label} className="h-full w-full" />
      </div>
      <div role="group" aria-label="Focus one signal layer"
        className="mx-auto mt-2 flex w-fit max-w-full flex-wrap justify-center gap-1 rounded-full border border-border bg-surface/70 p-1 backdrop-blur">
        {[['All signals', -1], ['ECG', 0], ['PPG', 1], ['Motion', 2]].map(([name, i]) => (
          <button key={name} type="button" aria-pressed={focus === i} onClick={() => setFocus(i as number)}
            className={cn('min-h-[40px] rounded-full px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              focus === i ? 'bg-primary/15 text-foreground shadow-[inset_0_0_0_1px_hsl(var(--primary)/.35)]' : 'text-muted hover:text-foreground')}>
            {name}
          </button>
        ))}
      </div>
      <figcaption className="mt-3 text-center text-xs text-muted">Illustrative signals, not measurements. Pick a layer to focus it.</figcaption>
    </figure>
  )
}
