import { useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import type { ShellCtx } from '@/components/AppShell'
import { SyntheticBadge } from '@/components/status'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { StateView } from '@/components/ui/misc'
import { api } from '@/lib/api'
import { fmt } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'

const PAGE = 25

export default function Sessions() {
  const { current, devices } = useOutletContext<ShellCtx>()
  const nav = useNavigate()
  const [scope, setScope] = useState<'device' | 'all'>('device')
  const [synthetic, setSynthetic] = useState<'any' | 'real' | 'sim'>('any')
  const [page, setPage] = useState(0)
  const r = useAsync(() => api.sessions({
    device_id: scope === 'device' ? current?.id : undefined, synthetic: synthetic === 'any' ? undefined : synthetic === 'sim',
    limit: PAGE, offset: page * PAGE,
  }), [scope, synthetic, page, current?.id], { refreshMs: 10000 })

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Sessions</h1>
        <div className="ml-auto flex flex-wrap gap-2">
          <Seg value={scope} onChange={(v) => { setScope(v as 'device' | 'all'); setPage(0) }} options={[['device', current ? current.name : 'This device'], ['all', `All devices (${devices.length})`]]} label="Scope" />
          <Seg value={synthetic} onChange={(v) => { setSynthetic(v as 'any' | 'real' | 'sim'); setPage(0) }} options={[['any', 'Any data'], ['real', 'Device data'], ['sim', 'Simulated']]} label="Data source" />
        </div>
      </div>
      <Card className="overflow-hidden">
        {r.error ? <StateView kind="error" title="Could not load sessions" body={r.error} action="Retry" onAction={r.reload} /> :
          r.loading && !r.data ? <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded bg-surface-2" />)}</div> :
            !r.data?.items.length ? <StateView kind="empty" title="No sessions" body="A session is recorded each time a device or scenario streams." /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <caption className="sr-only">Recorded sessions</caption>
                  <thead className="border-b border-border bg-surface-2/50 text-left text-xs text-muted">
                    <tr>{['Started', 'Device', 'Duration', 'Source', 'Frames', 'Lost', 'CRC', 'Data', ''].map((h) => <th key={h} scope="col" className="px-4 py-2.5 font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {r.data.items.map((s) => (
                      <tr key={s.id} className="cursor-pointer hover:bg-surface-2/50" onClick={() => nav(`/app/history/${s.id}`)}>
                        <td className="px-4 py-2.5"><div className="font-medium">{fmt.dateTime(s.started_at)}</div>{s.label && <div className="text-xs text-muted">{s.label}</div>}</td>
                        <td className="px-4 py-2.5">{s.device_name}</td>
                        <td className="px-4 py-2.5 font-mono tabular-nums">{fmt.duration(s.duration_s)} {s.active && <Badge tone="ok" className="ml-1">live</Badge>}</td>
                        <td className="max-w-[200px] truncate px-4 py-2.5 text-xs text-muted" title={s.source}>{s.source}</td>
                        <td className="px-4 py-2.5 font-mono tabular-nums">{fmt.int(s.stats.frames_ok)}</td>
                        <td className="px-4 py-2.5 font-mono tabular-nums">{fmt.int(s.stats.lost_frames)}</td>
                        <td className="px-4 py-2.5 font-mono tabular-nums">{fmt.int(s.stats.crc_errors)}</td>
                        <td className="px-4 py-2.5">{s.synthetic ? <SyntheticBadge /> : <Badge tone="info">device</Badge>}</td>
                        <td className="px-4 py-2.5 text-right"><Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); nav(`/app/history/${s.id}`) }}>Open</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </Card>
      {r.data && r.data.total > PAGE && (
        <div className="flex items-center justify-end gap-2 text-xs text-muted">
          <span>{page * PAGE + 1}–{Math.min(r.data.total, (page + 1) * PAGE)} of {r.data.total}</span>
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button size="sm" variant="outline" disabled={(page + 1) * PAGE >= r.data.total} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  )
}

export function Seg({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: [string, string][]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-border bg-surface-2 p-0.5">
      {options.map(([v, l]) => (
        <button key={v} role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={`rounded-[6px] px-2.5 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${value === v ? 'bg-surface text-foreground shadow-sm' : 'text-muted hover:text-foreground'}`}>{l}</button>
      ))}
    </div>
  )
}
