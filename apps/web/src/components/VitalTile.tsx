import type { ReactNode } from 'react'
import type { Quality } from '@mesp/types'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tip } from './ui/tooltip'

const qTone: Record<Quality, string> = { good: 'text-ok', fair: 'text-warning', poor: 'text-critical' }

export function VitalTile({ label, value, unit, sub, quality, accent, icon, unavailable, hint, stale }: {
  label: string; value: ReactNode; unit?: string; sub?: ReactNode; quality?: Quality | null; accent?: string; icon?: ReactNode
  unavailable?: string; hint?: string; stale?: boolean
}) {
  return (
    <div className={cn('relative overflow-hidden rounded-lg border border-border bg-surface p-4 transition-opacity', stale && 'opacity-60')}>
      {accent && <div className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} aria-hidden />}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted">
          <span className="shrink-0">{icon}</span><span className="truncate">{label}</span>
          {hint && (
            <Tip content={hint}>
              <button type="button" aria-label={`About ${label}: ${hint}`} className="shrink-0 rounded-full text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Info className="h-3 w-3" />
              </button>
            </Tip>
          )}
        </div>
        {quality && <span className={cn('shrink-0 text-[10px] font-semibold uppercase tracking-wider', qTone[quality])}>{quality}</span>}
      </div>
      {unavailable ? (
        <div className="mt-3">
          <div className="text-lg font-semibold text-muted">Not available</div>
          <div className="mt-1 text-[11px] leading-snug text-muted">{unavailable}</div>
        </div>
      ) : (
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className={cn('font-semibold tabular-nums tracking-tight', typeof value === 'string' && /[a-z]/i.test(value) ? 'text-2xl sm:text-[26px]' : 'font-mono text-3xl sm:text-4xl')}
            style={accent ? { color: accent } : undefined}>{value}</span>
          {unit && <span className="text-sm text-muted">{unit}</span>}
        </div>
      )}
      {sub && !unavailable && <div className="mt-1 text-[11px] text-muted">{sub}</div>}
    </div>
  )
}
