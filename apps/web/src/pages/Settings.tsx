import { Monitor, Moon, Sun } from 'lucide-react'
import { Disclaimer } from '@/components/status'
import { Badge } from '@/components/ui/badge'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Kbd, StateView } from '@/components/ui/misc'
import { api } from '@/lib/api'
import { can, useAuth } from '@/lib/auth'
import { fmt } from '@/lib/format'
import { useUi } from '@/lib/ui'
import { useAsync } from '@/lib/useAsync'
import { cn } from '@/lib/utils'

export default function Settings() {
  const { email, role, demo } = useAuth()
  const { theme, setTheme } = useUi()
  const meta = useAsync(() => api.meta(), [])
  const admin = can(role, 'admin')
  const audit = useAsync(() => (admin ? api.audit() : Promise.resolve([])), [admin])
  const users = useAsync(() => (admin ? api.users() : Promise.resolve([])), [admin])
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <Card>
        <CardHeader title="Appearance" />
        <CardBody>
          <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2 sm:max-w-md">
            {([['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'System', Monitor]] as const).map(([v, l, Icon]) => (
              <button key={v} role="radio" aria-checked={theme === v} onClick={() => setTheme(v)}
                className={cn('flex flex-col items-center gap-1.5 rounded-md border p-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', theme === v ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-surface-2')}>
                <Icon className="h-4 w-4" />{l}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">Motion follows your operating-system “reduce motion” setting: waveforms then update once per batch instead of scrolling smoothly, and landing-page animations are disabled.</p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Account" />
        <CardBody className="text-sm">
          <div className="flex flex-wrap items-center gap-2">{email} <Badge tone="primary">{role}</Badge>{demo && <Badge tone="synthetic">demo session</Badge>}</div>
          <p className="mt-2 text-xs text-muted">Your session token is kept in this tab only and expires automatically.</p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Keyboard shortcuts (focused waveform)" />
        <CardBody className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
          {[['Space', 'Pause / resume'], ['+ / −', 'Zoom time window'], ['← / →', 'Pan while paused'], ['F', 'Full screen'], ['0', 'Reset view'], ['Double-click', 'Pause / resume']].map(([k, v]) => (
            <div key={k} className="flex items-center gap-2"><Kbd>{k}</Kbd><span className="text-muted">{v}</span></div>
          ))}
        </CardBody>
      </Card>
      {admin && (
        <>
          <Card>
            <CardHeader title="Users" subtitle="Create users via the API (POST /api/v1/users); roles: viewer, operator, admin." />
            <CardBody>
              <ul className="divide-y divide-border text-sm">{users.data?.map((u) => <li key={u.id} className="flex items-center justify-between py-2"><span>{u.email}</span><span className="flex gap-1.5">{u.disabled && <Badge tone="critical">disabled</Badge>}<Badge>{u.role}</Badge></span></li>)}</ul>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Audit log" subtitle="Logins, exports, device and key changes, acknowledgements" />
            <CardBody className="max-h-80 overflow-y-auto">
              {!audit.data?.length ? <StateView compact kind="empty" title="No entries" /> : (
                <table className="w-full text-xs"><tbody className="divide-y divide-border">
                  {audit.data.map((a, i) => <tr key={i}><td className="py-1.5 pr-3 font-mono text-muted">{fmt.dateTime(a.at)}</td><td className="pr-3">{a.actor}</td><td className="pr-3 font-medium">{a.action}</td><td className="truncate text-muted">{a.target}</td></tr>)}
                </tbody></table>
              )}
            </CardBody>
          </Card>
        </>
      )}
      <Card>
        <CardHeader title="About" />
        <CardBody className="space-y-2 text-xs text-muted">
          <p>MESP platform v{meta.data?.version ?? '—'} · link protocol v1 · ingest v1 · live WebSocket v1</p>
          <Disclaimer />
        </CardBody>
      </Card>
    </div>
  )
}
