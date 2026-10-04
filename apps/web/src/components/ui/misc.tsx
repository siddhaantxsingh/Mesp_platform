import type { ReactNode } from 'react'
import { AlertTriangle, Inbox, Loader2, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './button'

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-surface-2', className)} aria-hidden />
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">{children}</kbd>
}

type StateKind = 'empty' | 'error' | 'offline' | 'loading'
const icons = { empty: Inbox, error: AlertTriangle, offline: WifiOff, loading: Loader2 }

export function StateView({ kind, title, body, action, onAction, className, compact }: {
  kind: StateKind; title: string; body?: ReactNode; action?: string; onAction?: () => void; className?: string; compact?: boolean
}) {
  const Icon = icons[kind]
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={cn('flex flex-col items-center justify-center text-center', compact ? 'gap-1.5 py-6' : 'gap-3 py-14', className)}>
      <div className={cn('grid place-items-center rounded-full border border-border bg-surface-2', compact ? 'h-9 w-9' : 'h-12 w-12', kind === 'error' && 'border-critical/40 text-critical')}>
        <Icon className={cn('h-5 w-5', kind === 'loading' && 'animate-spin text-muted')} aria-hidden />
      </div>
      <div className="text-sm font-medium">{title}</div>
      {body && <div className="max-w-sm text-xs leading-relaxed text-muted">{body}</div>}
      {action && onAction && <Button size="sm" variant="outline" onClick={onAction}>{action}</Button>}
    </div>
  )
}
