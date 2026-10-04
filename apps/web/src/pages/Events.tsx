import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { MespEvent } from '@mesp/types'
import { AckDialog } from '@/components/AckDialog'
import type { ShellCtx } from '@/components/AppShell'
import { EventRow } from '@/components/EventRow'
import { Card } from '@/components/ui/card'
import { StateView } from '@/components/ui/misc'
import { api } from '@/lib/api'
import { can, useAuth } from '@/lib/auth'
import { useAsync } from '@/lib/useAsync'
import { Seg } from './Sessions'

export default function Events() {
  const { current } = useOutletContext<ShellCtx>()
  const role = useAuth((s) => s.role)
  const [sev, setSev] = useState('')
  const [ack, setAck] = useState<'open' | 'acked' | 'all'>('open')
  const [scope, setScope] = useState<'device' | 'all'>('all')
  const [target, setTarget] = useState<MespEvent | null>(null)
  const r = useAsync(() => api.events({
    severity: sev || undefined, acknowledged: ack === 'all' ? undefined : ack === 'acked',
    device_id: scope === 'device' ? current?.id : undefined, limit: 200,
  }), [sev, ack, scope, current?.id], { refreshMs: 5000 })
  const u = r.data?.unacknowledged

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Events</h1>
        {u && <span className="text-xs text-muted"><b className="text-critical">{u.CRITICAL}</b> critical · <b className="text-warning">{u.WARNING}</b> warning · <b className="text-info">{u.INFO}</b> info unacknowledged</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Seg label="Status" value={ack} onChange={(v) => setAck(v as typeof ack)} options={[['open', 'Unacknowledged'], ['acked', 'Acknowledged'], ['all', 'All']]} />
        <Seg label="Severity" value={sev} onChange={setSev} options={[['', 'Any severity'], ['CRITICAL', 'Critical'], ['WARNING', 'Warning'], ['INFO', 'Info']]} />
        <Seg label="Scope" value={scope} onChange={(v) => setScope(v as typeof scope)} options={[['all', 'All devices'], ['device', current?.name ?? 'This device']]} />
      </div>
      <Card className="p-2">
        {r.error ? <StateView kind="error" title="Could not load events" body={r.error} action="Retry" onAction={r.reload} /> :
          r.loading && !r.data ? <div className="space-y-2 p-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded bg-surface-2" />)}</div> :
            !r.data?.items.length ? <StateView kind="empty" title={ack === 'open' ? 'Nothing needs attention' : 'No events match'} body="Events are raised by rules on the signal (e.g. lead-off, low SpO₂ estimate, suspected fall) and on the link (disconnects, packet loss, CRC errors)." /> :
              <ul className="space-y-1">{r.data.items.map((e) => <EventRow key={e.id} e={e} onAck={can(role, 'operator') ? setTarget : undefined} />)}</ul>}
      </Card>
      <p className="text-[11px] text-muted">Thresholds are engineering defaults for this prototype, not clinical limits. Event wording describes signal patterns and never constitutes a diagnosis.</p>
      <AckDialog event={target} onClose={() => setTarget(null)} onDone={() => r.reload()} />
    </div>
  )
}
