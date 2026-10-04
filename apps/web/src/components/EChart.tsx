import { useEffect, useRef } from 'react'
import type { EChartsOption } from 'echarts'
import type { EChartsType as ECharts } from 'echarts/core'
import { cn } from '@/lib/utils'

/** Thin ECharts wrapper: lazy-loads the library, resizes with its container, re-themes on dark/light. */
export function EChart({ option, className, height = 260, onReady, ariaLabel }: {
  option: EChartsOption; className?: string; height?: number; onReady?: (c: ECharts) => void; ariaLabel: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<ECharts | null>(null)
  const readyRef = useRef(onReady)
  readyRef.current = onReady

  useEffect(() => {
    let disposed = false
    let ro: ResizeObserver | null = null
    import('@/lib/echarts').then(({ default: ec }) => {
      if (disposed || !ref.current) return
      chart.current = ec.init(ref.current, undefined, { renderer: 'canvas' })
      chart.current.setOption(option)
      readyRef.current?.(chart.current)
      ro = new ResizeObserver(() => chart.current?.resize())
      ro.observe(ref.current)
    })
    return () => { disposed = true; ro?.disconnect(); chart.current?.dispose(); chart.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { chart.current?.setOption(option, { notMerge: false, lazyUpdate: true }) }, [option])

  return <div ref={ref} role="img" aria-label={ariaLabel} className={cn('w-full', className)} style={{ height }} />
}

export function chartTheme() {
  const v = (n: string, a = 1) => {
    const x = getComputedStyle(document.documentElement).getPropertyValue(n).trim()
    return `hsla(${x.replace(/ /g, ', ')}, ${a})`
  }
  return {
    text: v('--muted'), fg: v('--foreground'), grid: v('--border', 0.7), surface: v('--surface'),
    ecg: v('--signal-ecg'), red: v('--signal-ppg-red'), ir: v('--signal-ppg-ir'),
    x: v('--signal-imu-x'), y: v('--signal-imu-y'), z: v('--signal-imu-z'), mag: v('--signal-imu-mag'),
    critical: v('--critical'), warning: v('--warning'), info: v('--info'), ok: v('--ok'), primary: v('--primary'),
  }
}
