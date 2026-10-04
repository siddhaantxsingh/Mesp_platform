/** MESP design tokens (source of truth). CSS variables live in tokens.css; Tailwind reads them. */
export const signal = {
  ecg: 'hsl(var(--signal-ecg))',
  ppgRed: 'hsl(var(--signal-ppg-red))',
  ppgIr: 'hsl(var(--signal-ppg-ir))',
  imuX: 'hsl(var(--signal-imu-x))',
  imuY: 'hsl(var(--signal-imu-y))',
  imuZ: 'hsl(var(--signal-imu-z))',
  imuMag: 'hsl(var(--signal-imu-mag))',
} as const

export const motion = { fast: 120, base: 200, slow: 420, cinematic: 900, ease: 'cubic-bezier(0.22, 1, 0.36, 1)' } as const
export const radius = { sm: 6, md: 10, lg: 16, xl: 24 } as const
export const space = [0, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128] as const

/** Read a token as a concrete colour string for canvas drawing. */
export function cssColor(name: string, alpha = 1, el: Element = document.documentElement): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim()
  return v ? `hsl(${v} / ${alpha})` : `rgba(128,128,128,${alpha})`
}
