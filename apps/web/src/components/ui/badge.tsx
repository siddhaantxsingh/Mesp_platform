import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type Tone = 'neutral' | 'primary' | 'ok' | 'info' | 'warning' | 'critical' | 'synthetic'
const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted border-border',
  primary: 'bg-primary/10 text-primary border-primary/30',
  ok: 'bg-ok/10 text-ok border-ok/30',
  info: 'bg-info/10 text-info border-info/30',
  warning: 'bg-warning/10 text-warning border-warning/30',
  critical: 'bg-critical/10 text-critical border-critical/30',
  synthetic: 'bg-[repeating-linear-gradient(135deg,hsl(var(--warning)/.14)_0_6px,transparent_6px_12px)] text-warning border-warning/40',
}

export function Badge({ tone = 'neutral', className, ...p }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4', tones[tone], className)} {...p} />
}
