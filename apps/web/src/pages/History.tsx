import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import type { EChartsOption } from 'echarts'
import type { EChartsType as ECharts } from 'echarts/core'
import { Download, LocateFixed } from 'lucide-react'
import type { MespEvent, SamplesResponse, Stream, Vitals } from '@mesp/types'
import type { ShellCtx } from '@/components/AppShell'
import { chartTheme, EChart } from '@/components/EChart'
import { EventRow } from '@/components/EventRow'
import { Disclaimer, SyntheticBadge } from '@/components/status'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { StateView } from '@/components/ui/misc'
import { Seg } from './Sessions'
import { api } from '@/lib/api'
import { fmt } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'

const SEV_COLOR = (t: ReturnType<typeof chartTheme>, s: string) => (s === 'CRITICAL' ? t.critical : s === 'WARNING' ? t.warning : t.info)

export default function History() {
  const { sessionId } = useParams()
  const [sp, setSp] = useSearchParams()
  const nav = useNavigate()
  const { current } = useOutletContext<ShellCtx>()

  // no session in the URL: open the newest session of the selected device
  const latest = useAsync(() => (sessionId ? Promise.resolve(null) : api.sessions({ device_id: current?.id, limit: 1 })), [sessionId, current?.id])
  useEffect(() => {
    const s = latest.data?.items?.[0]
    if (!sessionId && s) nav(`/app/history/${s.id}`, { replace: true })
  }, [latest.data, sessionId, nav])

  const session = useAsync(() => (sessionId ? api.session(sessionId) : Promise.resolve(null)), [sessionId], { refreshMs: 10000 })
  const vit = useAsync(() => (sessionId ? api.vitals(sessionId) : Promise.resolve(null)), [sessionId], { refreshMs: session.data?.active ? 5000 : undefined })
  const evs = useAsync(() => (sessionId ? api.events({ session_id: sessionId, limit: 500 }) : Promise.resolve(null)), [sessionId], { refreshMs: session.data?.active ? 8000 : undefined })
  const analytics = useAsync(() => (sessionId ? api.analytics(sessionId) : Promise.resolve(null)), [sessionId, vit.data?.items.length])
  const sessions = useAsync(() => api.sessions({ device_id: current?.id, limit: 30 }), [current?.id])

  const focusT = sp.get('t') ? Number(sp.get('t')) : null
  const [stream, setStream] = useState<Stream>((sp.get('stream') as Stream) || 'ecg')
  const [view, setView] = useState<[number, number] | null>(null)
  const [exportOpen, setExportOpen] = useState(false)

  const s = session.data
  const t0 = s?.data_start ?? s?.started_at ?? 0
  const t1 = s?.data_end ?? (s?.ended_at ?? Date.now() / 1000)

  // initial viewport: around a linked event, else the last 60 s
  useEffect(() => {
    if (!s) return
    if (focusT) setView([focusT - 10, focusT + 10])
    else setView((v) => v ?? [Math.max(t0, t1 - 60), t1])
  }, [s?.id, focusT]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!sessionId) {
    if (latest.loading) return <StateView kind="loading" title="Loading sessions…" />
    return <StateView kind="empty" title="No recorded sessions" body="Sessions are created automatically whenever a device or demo scenario streams." action="Go to scenarios" onAction={() => nav('/app/demo')} />
  }
  if (session.error) return <StateView kind="error" title="Session not available" body={session.error} action="All sessions" onAction={() => nav('/app/sessions')} />
  if (!s) return <StateView kind="loading" title="Loading session…" />

  const focusEvent = (e: MespEvent) => {
    setSp({ t: String(e.t), event: e.id, ...(e.stream ? { stream: e.stream } : {}) })
    if (e.stream) setStream(e.stream)
    setView([e.t - 10, e.t + 10])
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-xl font-semibold tracking-tight">History</h1>
        <label htmlFor="session-pick" className="sr-only">Session</label>
        <select id="session-pick" value={s.id} onChange={(e) => nav(`/app/history/${e.target.value}`)}
          className="h-9 max-w-full rounded-md border border-border bg-surface px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
          {!sessions.data?.items.some((x) => x.id === s.id) && <option value={s.id}>{fmt.dateTime(s.started_at)}</option>}
          {sessions.data?.items.map((x) => <option key={x.id} value={x.id}>{fmt.dateTime(x.started_at)} · {fmt.duration(x.duration_s)}{x.label ? ` · ${x.label}` : ''}</option>)}
        </select>
        {s.synthetic && <SyntheticBadge />}
        {s.active && <Badge tone="ok">Recording</Badge>}
        <span className="text-xs text-muted">{s.device_name} · {s.source} · {fmt.duration(s.duration_s)}</span>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => setExportOpen(true)}><Download className="h-3.5 w-3.5" />Export</Button>
      </div>

      <VitalsChart items={vit.data?.items ?? []} events={evs.data?.items ?? []} view={view} onView={setView} loading={vit.loading} onEvent={focusEvent} />

      <RawPanel sessionId={s.id} stream={stream} setStream={setStream} view={view} focusT={focusT} span={[t0, t1]} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Analytics a={analytics.data} />
        <Card className="lg:col-span-1">
          <CardHeader title="Events in this session" subtitle={`${evs.data?.total ?? 0} total`} />
          <CardBody className="max-h-[420px] overflow-y-auto px-2">
            {!evs.data?.items.length ? <StateView compact kind="empty" title="No events" /> : (
              <ul className="space-y-1">
                {evs.data.items.map((e) => <EventRow key={e.id} e={e} compact onOpen={focusEvent} highlight={sp.get('event') === e.id} />)}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
      <Disclaimer />
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} sessionId={s.id} synthetic={s.synthetic} />
    </div>
  )
}

function VitalsChart({ items, events, view, onView, loading, onEvent }: {
  items: Vitals[]; events: MespEvent[]; view: [number, number] | null; onView: (v: [number, number]) => void; loading: boolean; onEvent: (e: MespEvent) => void
}) {
  const chartRef = useRef<ECharts | null>(null)
  const theme = chartTheme()
  const option = useMemo<EChartsOption>(() => {
    const ms = (t: number) => t * 1000
    const series = (k: keyof Vitals) => items.map((v) => [ms(v.t), v[k] as number | null])
    return {
      animation: false,
      textStyle: { fontFamily: 'Inter Variable, system-ui', color: theme.text },
      grid: [{ left: 48, right: 48, top: 30, height: '52%' }, { left: 48, right: 48, top: '72%', height: '14%' }],
      legend: { top: 0, textStyle: { color: theme.text }, itemWidth: 14, itemHeight: 2 },
      tooltip: { trigger: 'axis', backgroundColor: theme.surface, borderColor: theme.grid, textStyle: { color: theme.fg, fontSize: 12 },
        valueFormatter: (v) => (v == null ? '—' : typeof v === 'number' ? v.toFixed(1) : String(v)) },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      xAxis: [0, 1].map((i) => ({ type: 'time' as const, gridIndex: i, axisLine: { lineStyle: { color: theme.grid } }, axisLabel: { color: theme.text, show: i === 1 }, splitLine: { show: false } })),
      yAxis: [
        { type: 'value', name: 'bpm', gridIndex: 0, scale: true, axisLabel: { color: theme.text }, nameTextStyle: { color: theme.text }, splitLine: { lineStyle: { color: theme.grid } } },
        { type: 'value', name: 'SpO₂ %', gridIndex: 0, min: 80, max: 100, position: 'right', axisLabel: { color: theme.text }, nameTextStyle: { color: theme.text }, splitLine: { show: false } },
        { type: 'value', name: 'g', gridIndex: 1, splitNumber: 2, axisLabel: { color: theme.text, fontSize: 10 }, nameTextStyle: { color: theme.text }, splitLine: { lineStyle: { color: theme.grid } } },
      ],
      dataZoom: [{ type: 'inside', xAxisIndex: [0, 1] }, { type: 'slider', xAxisIndex: [0, 1], bottom: 4, height: 18, borderColor: theme.grid, textStyle: { color: theme.text } }],
      series: [
        { name: 'HR (ECG)', type: 'line', showSymbol: false, connectNulls: false, data: series('hr_ecg'), lineStyle: { color: theme.ecg, width: 1.6 }, itemStyle: { color: theme.ecg },
          markLine: { symbol: 'none', silent: false, animation: false, label: { show: false },
            data: events.map((e) => ({ xAxis: ms(e.t), name: e.title, lineStyle: { color: SEV_COLOR(theme, e.severity), type: 'dashed', width: 1 }, eventId: e.id })) } },
        { name: 'Pulse (PPG)', type: 'line', showSymbol: false, connectNulls: false, data: series('hr_ppg'), lineStyle: { color: theme.ir, width: 1.2 }, itemStyle: { color: theme.ir } },
        { name: 'SpO₂ est.', type: 'line', yAxisIndex: 1, showSymbol: false, connectNulls: false, data: series('spo2'), lineStyle: { color: theme.red, width: 1.2 }, itemStyle: { color: theme.red } },
        { name: 'Motion', type: 'line', xAxisIndex: 1, yAxisIndex: 2, showSymbol: false, areaStyle: { opacity: 0.15 }, data: series('motion_g'), lineStyle: { color: theme.x, width: 1 }, itemStyle: { color: theme.x } },
      ],
    }
  }, [items, events]) // eslint-disable-line react-hooks/exhaustive-deps

  // reflect the shared viewport in the chart
  useEffect(() => {
    if (!view || !chartRef.current) return
    chartRef.current.dispatchAction({ type: 'dataZoom', startValue: view[0] * 1000, endValue: view[1] * 1000 })
  }, [view])

  const onReady = (c: ECharts) => {
    chartRef.current = c
    let timer: ReturnType<typeof setTimeout> | null = null
    c.on('datazoom', () => {
      const opt = c.getOption() as { dataZoom: { startValue: number; endValue: number }[] }
      const z = opt.dataZoom?.[0]
      if (!z) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => onView([z.startValue / 1000, z.endValue / 1000]), 250)
    })
    c.on('click', (p) => {
      const id = (p.data as { eventId?: string } | null)?.eventId
      if (p.componentType === 'markLine' && id) {
        const e = events.find((x) => x.id === id)
        if (e) onEvent(e)
      }
    })
    if (view) c.dispatchAction({ type: 'dataZoom', startValue: view[0] * 1000, endValue: view[1] * 1000 })
  }

  return (
    <Card>
      <CardHeader title="Vitals timeline" subtitle="1 Hz derived values. Gaps = value withheld (poor signal) or no data. Dashed lines = events (click to inspect)." />
      <CardBody>
        {loading && !items.length ? <div className="h-[320px] animate-pulse rounded-md bg-surface-2" /> :
          !items.length ? <StateView kind="empty" title="No derived values yet" body="Vitals appear after ~4 s of signal." /> :
            <EChart option={option} height={320} onReady={onReady} ariaLabel={`Vitals timeline with ${items.length} points and ${events.length} event markers`} />}
      </CardBody>
    </Card>
  )
}

function RawPanel({ sessionId, stream, setStream, view, focusT, span }: {
  sessionId: string; stream: Stream; setStream: (s: Stream) => void; view: [number, number] | null; focusT: number | null; span: [number, number]
}) {
  const theme = chartTheme()
  const [data, setData] = useState<SamplesResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [imuGroup, setImuGroup] = useState<'accel' | 'gyro'>('accel')
  const range = view ?? [span[1] - 30, span[1]]
  const tooLong = range[1] - range[0] > 1800

  useEffect(() => {
    if (tooLong) { setData(null); return }
    let cancelled = false
    setLoading(true)
    api.samples(sessionId, stream, range[0], range[1], 3000)
      .then((d) => { if (!cancelled) { setData(d); setErr(null) } })
      .catch((e) => !cancelled && setErr(e.message))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [sessionId, stream, range[0], range[1]]) // eslint-disable-line react-hooks/exhaustive-deps

  const option = useMemo<EChartsOption | null>(() => {
    if (!data) return null
    const colors: Record<string, string> = { ecg: theme.ecg, red: theme.red, ir: theme.ir, ax: theme.x, ay: theme.y, az: theme.z, gx: theme.x, gy: theme.y, gz: theme.z }
    const show = data.channels.filter((c) => c.name !== 'imu_temp' && (data.stream !== 'imu' || c.name.startsWith(imuGroup === 'accel' ? 'a' : 'g')))
    const t = data.t.map((x) => (x == null ? null : x * 1000))
    return {
      animation: false,
      grid: { left: 64, right: 24, top: 28, bottom: 32 },
      legend: { top: 0, textStyle: { color: theme.text }, itemWidth: 14, itemHeight: 2 },
      tooltip: { trigger: 'axis', backgroundColor: theme.surface, borderColor: theme.grid, textStyle: { color: theme.fg, fontSize: 12 } },
      xAxis: { type: 'time', axisLabel: { color: theme.text }, axisLine: { lineStyle: { color: theme.grid } } },
      yAxis: { type: 'value', scale: true, name: show[0]?.unit, nameTextStyle: { color: theme.text }, axisLabel: { color: theme.text }, splitLine: { lineStyle: { color: theme.grid } } },
      series: show.map((c) => ({
        name: c.name, type: 'line', showSymbol: false, connectNulls: false, sampling: undefined, lineStyle: { width: 1.1, color: colors[c.name] }, itemStyle: { color: colors[c.name] },
        data: t.map((tt, i) => [tt, c.values[i]]),
        markLine: focusT ? { symbol: 'none', silent: true, label: { show: false }, data: [{ xAxis: focusT * 1000, lineStyle: { color: theme.warning, width: 1.5 } }] } : undefined,
      })),
    }
  }, [data, focusT, imuGroup]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card>
      <div>
        <CardHeader title="Sensor timeline"
          subtitle={`${fmt.time(range[0])} – ${fmt.time(range[1])} · ${data ? `${data.points.toLocaleString()} points from ${data.source_samples.toLocaleString()} samples${data.decimated ? ' (min/max envelope)' : ''}` : ''}`}
          action={<>
            {focusT && <Badge tone="warning"><LocateFixed className="h-3 w-3" />event</Badge>}
            {stream === 'imu' && (
              <select aria-label="IMU channels" value={imuGroup} onChange={(e) => setImuGroup(e.target.value as 'accel' | 'gyro')}
                className="h-7 rounded-md border border-border bg-surface px-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="accel">Accel (g)</option><option value="gyro">Gyro (°/s)</option>
              </select>
            )}
            <Seg label="Stream" value={stream} onChange={(v) => setStream(v as Stream)} options={[['ecg', 'ECG'], ['ppg', 'PPG'], ['imu', 'IMU']]} />
          </>} />
      </div>
      <CardBody>
        {tooLong ? <StateView compact kind="empty" title="Zoom in to see raw samples" body="Raw sensor data loads for windows up to 30 minutes. Drag on the vitals timeline to zoom." /> :
          err ? <StateView compact kind="error" title="Could not load samples" body={err} /> :
            !data && loading ? <div className="h-[260px] animate-pulse rounded-md bg-surface-2" /> :
              data && !data.source_samples ? <StateView compact kind="empty" title="No samples in this window" body="The device may have been disconnected, or raw data has passed the retention period." /> :
                option && <EChart option={option} height={260} ariaLabel={`${stream.toUpperCase()} samples from ${fmt.time(range[0])} to ${fmt.time(range[1])}`} />}
      </CardBody>
    </Card>
  )
}

function Analytics({ a }: { a: Record<string, any> | null }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const theme = chartTheme()
  if (!a) return <Card className="lg:col-span-2"><CardBody><div className="h-60 animate-pulse rounded-md bg-surface-2" /></CardBody></Card>
  const hist = a.spo2_histogram
  const stat = (o: { min: number; mean: number; max: number } | null, d = 0) => (o ? `${o.min.toFixed(d)} / ${o.mean.toFixed(d)} / ${o.max.toFixed(d)}` : '—')
  const histOpt: EChartsOption | null = hist ? {
    animation: false, grid: { left: 36, right: 8, top: 10, bottom: 24 },
    xAxis: { type: 'category', data: hist.edges.slice(0, -1).map((e: number) => String(e)), axisLabel: { color: theme.text, fontSize: 10 } },
    yAxis: { type: 'value', name: 's', axisLabel: { color: theme.text, fontSize: 10 }, splitLine: { lineStyle: { color: theme.grid } } },
    series: [{ type: 'bar', data: hist.counts, itemStyle: { color: theme.red, borderRadius: [3, 3, 0, 0] } }],
    tooltip: { trigger: 'axis' },
  } : null
  const total = (o: Record<string, number>) => Object.values(o || {}).reduce((x, y) => x + y, 0) || 1
  const bars = (o: Record<string, number>, keys: string[], tones: Record<string, string>) => (
    <div className="flex h-2 overflow-hidden rounded-full bg-surface-2">
      {keys.map((k) => <div key={k} title={`${k}: ${o?.[k] ?? 0} s`} style={{ width: `${((o?.[k] ?? 0) / total(o)) * 100}%`, background: tones[k] }} />)}
    </div>
  )
  const link = a.link || {}
  return (
    <Card className="lg:col-span-2">
      <CardHeader title="Session analytics" subtitle={`${a.seconds_with_vitals} s with derived values${a.synthetic ? ' · computed on SIMULATED DATA' : ''}`} />
      <CardBody className="grid gap-5 sm:grid-cols-2">
        <dl className="space-y-2.5 text-sm">
          <Row k="HR · ECG (min / mean / max)" v={`${stat(a.hr_ecg)} bpm`} />
          <Row k="Pulse · PPG (min / mean / max)" v={`${stat(a.hr_ppg)} bpm`} />
          <Row k="SpO₂ estimate (min / mean / max)" v={`${stat(a.spo2)} %`} />
          <Row k="ECG vs PPG HR agreement" v={a.hr_agreement ? `${a.hr_agreement.mean_diff_bpm.toFixed(1)} ± ${a.hr_agreement.sd_diff_bpm.toFixed(1)} bpm (n=${a.hr_agreement.n})` : 'Not enough paired values'} />
          <Row k="Frames OK / lost / CRC" v={`${fmt.int(link.frames_ok)} / ${fmt.int(link.lost_frames)} / ${fmt.int(link.crc_errors)}`} />
          <Row k="Loss ratio" v={link.loss_ratio == null ? '—' : fmt.pct(link.loss_ratio, 2)} />
          <Row k="Ingest latency p50 / p95" v={link.latency_ms_p50 == null ? 'Not yet measured' : `${link.latency_ms_p50} / ${link.latency_ms_p95} ms`} />
        </dl>
        <div className="space-y-4">
          <div>
            <div className="mb-1 text-xs text-muted">SpO₂ estimate distribution</div>
            {histOpt ? <EChart option={histOpt} height={120} ariaLabel="SpO2 estimate histogram" /> : <div className="text-xs text-muted">No SpO₂ values</div>}
          </div>
          <div className="space-y-2 text-xs">
            <div className="text-muted">Activity</div>
            {bars(a.activity_seconds, ['still', 'light', 'active'], { still: theme.ok, light: theme.warning, active: theme.critical })}
            <div className="text-muted">ECG signal quality</div>
            {bars(a.ecg_quality_seconds, ['good', 'fair', 'poor'], { good: theme.ok, fair: theme.warning, poor: theme.critical })}
            <div className="text-muted">PPG signal quality</div>
            {bars(a.ppg_quality_seconds, ['good', 'fair', 'poor'], { good: theme.ok, fair: theme.warning, poor: theme.critical })}
          </div>
        </div>
      </CardBody>
    </Card>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-2"><dt className="text-xs text-muted">{k}</dt><dd className="text-right font-mono text-xs tabular-nums">{v}</dd></div>
}

function ExportDialog({ open, onClose, sessionId, synthetic }: { open: boolean; onClose: () => void; sessionId: string; synthetic: boolean }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const go = async (stream: string, format: 'csv' | 'json') => {
    setBusy(stream + format); setErr(null)
    try { await api.download(api.exportUrl(sessionId, stream, format)) } catch (e) { setErr(e instanceof Error ? e.message : 'Export failed') } finally { setBusy(null) }
  }
  const rows: [string, string][] = [['vitals', '1 Hz derived values'], ['events', 'Events with acknowledgements'], ['ecg', 'Raw ECG (first 30 min)'], ['ppg', 'Raw PPG (first 30 min)'], ['imu', 'Raw IMU (first 30 min)']]
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Export session"
      description={synthetic ? 'Files are labelled SIMULATED DATA in their name and header.' : 'Files include the device profile and the research-prototype disclaimer. Every export is audit-logged.'}>
      <ul className="divide-y divide-border rounded-md border border-border">
        {rows.map(([k, label]) => (
          <li key={k} className="flex items-center justify-between gap-2 px-3 py-2.5">
            <span className="text-sm">{label}</span>
            <span className="flex gap-1.5">
              <Button size="sm" variant="outline" loading={busy === k + 'csv'} onClick={() => go(k, 'csv')}>CSV</Button>
              <Button size="sm" variant="outline" loading={busy === k + 'json'} onClick={() => go(k, 'json')}>JSON</Button>
            </span>
          </li>
        ))}
      </ul>
      {err && <p role="alert" className="mt-2 text-xs text-critical">{err}</p>}
    </Dialog>
  )
}
