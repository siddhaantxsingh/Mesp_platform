import * as S from '@radix-ui/react-switch'

export function Switch({ checked, onCheckedChange, label, id }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: string; id: string }) {
  return (
    <div className="flex items-center gap-2">
      <S.Root id={id} checked={checked} onCheckedChange={onCheckedChange} aria-label={label}
        className="relative h-5 w-9 rounded-full border border-border bg-surface-2 transition-colors data-[state=checked]:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <S.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-foreground shadow transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-primary-foreground" />
      </S.Root>
      <label htmlFor={id} className="text-sm">{label}</label>
    </div>
  )
}
