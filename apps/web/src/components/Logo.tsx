import { cn } from '@/lib/utils'

export function Logo({ compact, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
        <rect width="32" height="32" rx="8" className="fill-surface-2" />
        <path d="M4 17h6l2.5-6 4 12 3-9 1.5 3H28" fill="none" stroke="hsl(var(--primary))" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {!compact && <span className="text-[15px]">MESP<span className="ml-1.5 font-normal text-muted">Monitor</span></span>}
    </span>
  )
}
