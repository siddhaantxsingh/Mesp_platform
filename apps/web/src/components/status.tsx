import { AlertOctagon, AlertTriangle, FlaskConical, Info } from 'lucide-react'
import type { Severity } from '@mesp/types'
import { DISCLAIMER } from '@mesp/types'
import type { Freshness } from '@/lib/live/store'
import { cn } from '@/lib/utils'
import { Badge } from './ui/badge'

const fresh: Record<Freshness, { tone: string; dot: string; label: string; help: string }> = {
  LIVE: { tone: 'border-ok/40 text-ok', dot: 'bg-ok animate-pulse2', label: 'LIVE', help: 'Samples are arriving in real time.' },
  STALE: { tone: 'border-warning/40 text-warning', dot: 'bg-warning', label: 'STALE', help: 'No new samples for a few seconds; values shown may be out of date.' },
  DISCONNECTED: { tone: 'border-critical/40 text-critical', dot: 'bg-critical', label: 'DISCONNECTED', help: 'The device link is down. Values are frozen at the last update.' },
  LOADING: { tone: 'border-border text-muted', dot: 'bg-muted animate-pulse2', label: 'LOADING', help: 'Connecting to the live stream.' },
  ERROR: { tone: 'border-critical/40 text-critical', dot: 'bg-critical', label: 'ERROR', help: 'The live stream could not be opened. Sign in again.' },
  'NO DATA': { tone: 'border-border text-muted', dot: 'bg-muted', label: 'NO DATA', help: 'This device has not streamed yet.' },
}

export function FreshnessPill({ state, className }: { state: Freshness; className?: string }) {
  const f = fresh[state]
  return (
    <span role="status" aria-live="polite" title={f.help}
      className={cn('inline-flex items-center gap-1.5 rounded-full border bg-surface px-2.5 py-1 font-mono text-[11px] font-semibold tracking-wider', f.tone, className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', f.dot)} aria-hidden />
      {f.label}
      <span className="sr-only">: {f.help}</span>
    </span>
  )
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const map = { INFO: ['info', Info], WARNING: ['warning', AlertTriangle], CRITICAL: ['critical', AlertOctagon] } as const
  const [tone, Icon] = map[severity]
  return <Badge tone={tone}><Icon className="h-3 w-3" aria-hidden />{severity}</Badge>
}

export function SyntheticBadge({ className }: { className?: string }) {
  return <Badge tone="synthetic" className={className}><FlaskConical className="h-3 w-3" aria-hidden />SIMULATED DATA</Badge>
}

export function DemoBanner() {
  return (
    <div role="note" className="flex items-center justify-center gap-2 border-b border-warning/30 bg-[repeating-linear-gradient(135deg,hsl(var(--warning)/.12)_0_10px,transparent_10px_20px)] px-4 py-1.5 text-center text-[11px] font-semibold tracking-[0.14em] text-warning">
      <FlaskConical className="h-3.5 w-3.5" aria-hidden /> DEMO MODE — SYNTHETIC DATA
    </div>
  )
}

export function Disclaimer({ className }: { className?: string }) {
  return <p className={cn('text-[11px] leading-relaxed text-muted', className)}>{DISCLAIMER}</p>
}
