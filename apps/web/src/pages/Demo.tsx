import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FlaskConical, Play, Square } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { StateView } from '@/components/ui/misc'
import { api } from '@/lib/api'
import { can, useAuth } from '@/lib/auth'
import { fmt } from '@/lib/format'
import { useUi } from '@/lib/ui'
import { useAsync } from '@/lib/useAsync'
import { cn } from '@/lib/utils'

export default function Demo() {
  const nav = useNavigate()
  const role = useAuth((s) => s.role)
  const setDevice = useUi((s) => s.setDevice)
  const sc = useAsync(() => api.scenarios(), [])
  const st = useAsync(() => api.demoStatus(), [], { refreshMs: 3000 })
  const [speed, setSpeed] = useState(1)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const start = async (id: string) => {
    setBusy(id); setErr(null)
    try {
      const s = await api.demoStart(id, speed)
      st.setData(s)
      if (s.device_id) setDevice(s.device_id)
      nav('/app/live')
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } finally { setBusy(null) }
  }
  const stop = async () => { setBusy('stop'); try { st.setData(await api.demoStop()) } finally { setBusy(null) } }

  if (sc.error?.includes('disabled') || st.error?.includes('disabled')) {
    return <StateView kind="empty" title="Demo mode is disabled on this server" body="Set MESP_DEMO_MODE=true to enable synthetic scenarios." />
  }
  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Scenarios</h1>
        <Badge tone="synthetic"><FlaskConical className="h-3 w-3" />DEMO MODE — SYNTHETIC DATA</Badge>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <label htmlFor="speed" className="text-muted">Speed</label>
          <select id="speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="h-8 rounded-md border border-border bg-surface px-2 focus:outline-none focus:ring-2 focus:ring-ring">
            {[1, 2, 4, 8].map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
          {st.data?.running && <Button size="sm" variant="outline" onClick={stop} loading={busy === 'stop'}><Square className="h-3.5 w-3.5" />Stop</Button>}
        </div>
      </div>
      <p className="max-w-3xl text-sm text-muted">
        Each scenario drives a simulated device that emits the <b className="text-foreground">same byte-level frames as the STM32 firmware</b> (sync word, sequence counter, CRC-16), through the same gateway deframer and ingest pipeline as real hardware. The data is synthetic and labelled as such everywhere: it tests the platform, not physiology.
      </p>
      {st.data?.running && (
        <Card className="border-primary/40"><CardBody className="flex flex-wrap items-center gap-3 pt-4 text-sm">
          <span className="h-2 w-2 animate-pulse2 rounded-full bg-ok" aria-hidden />
          Running <b>{sc.data?.find((s) => s.id === st.data?.scenario)?.title ?? st.data.replay}</b> since {fmt.time(st.data.started_at)}
          <Button size="sm" variant="primary" className="ml-auto" onClick={() => nav('/app/live')}>Open live view</Button>
        </CardBody></Card>
      )}
      {err && <p role="alert" className="text-sm text-critical">{err}</p>}
      {sc.loading && !sc.data ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-40 animate-pulse rounded-lg bg-surface-2" />)}</div> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sc.data?.map((s, i) => {
            const active = st.data?.running && st.data.scenario === s.id
            return (
              <Card key={s.id} className={cn('flex flex-col', active && 'border-primary/60 ring-1 ring-primary/30')}>
                <CardHeader title={<><span className="font-mono text-xs text-muted">{String(i + 1).padStart(2, '0')}</span>{s.title}</>} subtitle={`${s.duration_s} s loop`} />
                <CardBody className="flex flex-1 flex-col">
                  <p className="flex-1 text-xs leading-relaxed text-muted">{s.description}</p>
                  {s.expected_events.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">{s.expected_events.map((e) => <Badge key={e} tone="neutral" className="font-mono">{e}</Badge>)}</div>
                  )}
                  <Button className="mt-4 w-full" size="sm" variant={active ? 'primary' : 'secondary'} disabled={!can(role, 'operator')} loading={busy === s.id} onClick={() => start(s.id)}>
                    <Play className="h-3.5 w-3.5" />{active ? 'Restart' : 'Run scenario'}
                  </Button>
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
