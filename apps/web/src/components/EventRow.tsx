import { Check, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { MespEvent } from '@mesp/types'
import { fmt } from '@/lib/format'
import { cn } from '@/lib/utils'
import { SeverityBadge, SyntheticBadge } from './status'

export function eventHref(e: MespEvent) {
  if (!e.session_id) return '/app/events'
  const p = new URLSearchParams({ t: String(e.t), event: e.id })
  if (e.stream) p.set('stream', e.stream)
  return `/app/history/${e.session_id}?${p}`
}

export function EventRow({ e, onAck, compact, onOpen, highlight }: { e: MespEvent; onAck?: (e: MespEvent) => void; compact?: boolean; onOpen?: (e: MespEvent) => void; highlight?: boolean }) {
  const acked = !!e.acknowledged_at
  return (
    <li className={cn('group flex items-start gap-3 rounded-md border border-transparent px-3 py-2.5 hover:border-border hover:bg-surface-2/60',
      e.severity === 'CRITICAL' && !acked && 'border-critical/30 bg-critical/5', highlight && 'ring-1 ring-primary/60')}>
      <div className="mt-0.5 shrink-0"><SeverityBadge severity={e.severity} /></div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn('text-sm font-medium', acked && 'text-muted')}>{e.title}</span>
          <span className="font-mono text-[11px] text-muted">{fmt.time(e.t)}</span>
          {e.synthetic && !compact && <SyntheticBadge />}
        </div>
        {!compact && <p className="mt-0.5 text-xs leading-relaxed text-muted">{e.detail}</p>}
        {acked && <p className="mt-1 flex items-center gap-1 text-[11px] text-ok"><Check className="h-3 w-3" />Acknowledged by {e.acknowledged_by}{e.ack_note ? ` — “${e.ack_note}”` : ''}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onAck && !acked && (
          <button onClick={() => onAck(e)} className="rounded-md border border-border px-2 py-1 text-[11px] font-medium hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Acknowledge
          </button>
        )}
        {onOpen ? (
          <button type="button" onClick={() => onOpen(e)} aria-label={`Show ${e.title} at ${fmt.time(e.t)} on the sensor timeline`}
            className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronRight className="h-4 w-4" />
          </button>
        ) : (
          <Link to={eventHref(e)} aria-label={`Open ${e.title} on the sensor timeline`}
            className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronRight className="h-4 w-4" />
          </Link>
        )}
      </div>
    </li>
  )
}
