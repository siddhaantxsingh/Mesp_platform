import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Activity, Bell, Cpu, FlaskConical, History, ListOrdered, LogOut, Menu, Moon, Settings, Sun, X } from 'lucide-react'
import type { Device } from '@mesp/types'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useLive } from '@/lib/live/store'
import { useUi } from '@/lib/ui'
import { useAsync } from '@/lib/useAsync'
import { cn } from '@/lib/utils'
import { DemoBanner } from './status'
import { Logo } from './Logo'

const NAV = [
  { to: '/app/live', label: 'Live', icon: Activity },
  { to: '/app/history', label: 'History', icon: History },
  { to: '/app/sessions', label: 'Sessions', icon: ListOrdered },
  { to: '/app/events', label: 'Events', icon: Bell },
  { to: '/app/devices', label: 'Devices', icon: Cpu },
  { to: '/app/demo', label: 'Scenarios', icon: FlaskConical },
  { to: '/app/settings', label: 'Settings', icon: Settings },
]

export function AppShell() {
  const { email, role, demo, logout } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const [open, setOpen] = useState(false)
  const { deviceId, setDevice, theme, setTheme } = useUi()
  const devices = useAsync<Device[]>(() => api.devices(), [], { refreshMs: 5000 })
  const conn = useLive((s) => s.conn)
  const liveDevs = useLive((s) => s.devices)
  const critical = useLive((s) => s.newCritical)
  const start = useLive((s) => s.start)
  const unacked = useAsync(() => api.events({ acknowledged: false, limit: 1 }), [], { refreshMs: 6000 })

  useEffect(() => { start() }, [start])
  useEffect(() => setOpen(false), [loc.pathname])
  useEffect(() => {
    const list = devices.data
    if (!list?.length) return
    if (!deviceId || !list.some((d) => d.id === deviceId)) setDevice((list.find((d) => d.online) ?? list[0]).id)
  }, [devices.data, deviceId, setDevice])

  const current = devices.data?.find((d) => d.id === deviceId)
  const synthetic = demo || current?.simulated || liveDevs[deviceId ?? '']?.synthetic
  const unackedCount = unacked.data ? Object.values(unacked.data.unacknowledged).reduce((a, b) => a + b, 0) : 0
  const dark = document.documentElement.classList.contains('dark')

  const sidebar = (
    <nav aria-label="Main" className="flex h-full flex-col gap-1 p-3">
      <div className="mb-4 flex items-center justify-between px-2 pt-1">
        <Logo />
        <button className="rounded-md p-1.5 text-muted hover:bg-surface-2 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-4 w-4" /></button>
      </div>
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to}
          className={({ isActive }) => cn('flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isActive ? 'bg-surface-2 text-foreground' : 'text-muted hover:bg-surface-2/60 hover:text-foreground')}>
          <Icon className="h-4 w-4" aria-hidden />
          <span className="flex-1">{label}</span>
          {label === 'Events' && unackedCount > 0 && (
            <span className="rounded-full bg-critical/15 px-1.5 text-[10px] font-semibold text-critical" aria-label={`${unackedCount} unacknowledged`}>{unackedCount}</span>
          )}
        </NavLink>
      ))}
      <div className="mt-auto space-y-2 border-t border-border pt-3">
        <div className="px-2 text-xs">
          <div className="truncate font-medium">{email}</div>
          <div className="text-muted">{role}{demo ? ' · demo' : ''}</div>
        </div>
        <div className="flex gap-1">
          <button onClick={() => setTheme(dark ? 'light' : 'dark')} className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border py-1.5 text-xs text-muted hover:text-foreground" aria-label={`Switch to ${dark ? 'light' : 'dark'} theme (current preference: ${theme})`}>
            {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}{dark ? 'Light' : 'Dark'}
          </button>
          <button onClick={() => { useLive.getState().stop(); logout(); nav('/login') }} className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border py-1.5 text-xs text-muted hover:text-foreground">
            <LogOut className="h-3.5 w-3.5" />Sign out
          </button>
        </div>
      </div>
    </nav>
  )

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">Skip to content</a>
      {synthetic && <DemoBanner />}
      <div className="flex flex-1">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-border bg-surface lg:block">{sidebar}</aside>
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
            <aside className="absolute inset-y-0 left-0 w-64 border-r border-border bg-surface">{sidebar}</aside>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur sm:px-6">
            <button className="rounded-md p-1.5 text-muted hover:bg-surface-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
            <div className="lg:hidden"><Logo compact /></div>
            <div className="ml-auto flex items-center gap-2">
              <label htmlFor="device-select" className="sr-only">Device</label>
              <select id="device-select" value={deviceId ?? ''} onChange={(e) => setDevice(e.target.value)}
                className="h-9 max-w-[52vw] rounded-md border border-border bg-surface px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring sm:max-w-xs">
                {!devices.data?.length && <option value="">No devices</option>}
                {devices.data?.map((d) => <option key={d.id} value={d.id}>{d.online ? '● ' : '○ '}{d.name}</option>)}
              </select>
              <span className={cn('hidden items-center gap-1.5 text-[11px] text-muted sm:flex')} title={`Live stream: ${conn}`}>
                <span className={cn('h-2 w-2 rounded-full', conn === 'open' ? 'bg-ok' : conn === 'reconnecting' || conn === 'connecting' ? 'bg-warning animate-pulse2' : 'bg-critical')} aria-hidden />
                <span className="sr-only">Live stream connection:</span>{conn === 'open' ? 'stream' : conn}
              </span>
            </div>
          </header>
          <main id="main" className="flex-1 px-4 py-5 sm:px-6 lg:px-8">
            <Outlet context={{ devices: devices.data ?? [], devicesLoading: devices.loading, devicesError: devices.error, reloadDevices: devices.reload, current }} />
          </main>
        </div>
      </div>
      <div aria-live="assertive" className="sr-only">{critical ? `Critical event: ${critical.title}. ${critical.detail}` : ''}</div>
    </div>
  )
}

export interface ShellCtx { devices: Device[]; devicesLoading: boolean; devicesError: string | null; reloadDevices: () => void; current: Device | undefined }
