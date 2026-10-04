import * as T from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

export const Tabs = T.Root
export const TabsContent = T.Content

export function TabsList({ className, ...p }: T.TabsListProps) {
  return <T.List className={cn('inline-flex items-center gap-0.5 rounded-md border border-border bg-surface-2 p-0.5', className)} {...p} />
}
export function TabsTrigger({ className, ...p }: T.TabsTriggerProps) {
  return (
    <T.Trigger
      className={cn('rounded-[6px] px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:text-foreground',
        'data-[state=active]:bg-surface data-[state=active]:text-foreground data-[state=active]:shadow-sm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
      {...p}
    />
  )
}
