import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger'
type Size = 'sm' | 'md' | 'lg' | 'icon'

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_0_1px_hsl(var(--primary)/.4),0_8px_24px_-12px_hsl(var(--primary)/.8)]',
  secondary: 'bg-surface-2 text-foreground hover:bg-surface-2/70 border border-border',
  outline: 'border border-border bg-transparent hover:bg-surface-2',
  ghost: 'hover:bg-surface-2 text-foreground',
  danger: 'bg-critical text-white hover:bg-critical/90',
}
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-12 px-6 text-base gap-2', icon: 'h-9 w-9',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: Variant; size?: Size; loading?: boolean }

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant = 'secondary', size = 'md', loading, disabled, children, ...p }, ref) => (
  <button
    ref={ref}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    className={cn(
      'inline-flex items-center justify-center rounded-md font-medium transition-[background,transform,box-shadow] duration-150 select-none',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      'active:scale-[.98] disabled:pointer-events-none disabled:opacity-50',
      variants[variant], sizes[size], className,
    )}
    {...p}
  >
    {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />}
    {children}
  </button>
))
Button.displayName = 'Button'
