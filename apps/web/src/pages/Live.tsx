import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import { Activity, BatteryMedium, Droplets, HeartPulse, Move3d, Radio, Waves } from 'lucide-react'
import type { MespEvent } from '@mesp/types'
import { cssColor } from '@mesp/ui'
import type { ShellCtx } from '@/components/AppShell'
import { AckDialog } from '@/components/AckDialog'
import { EventRow } from '@/components/EventRow'
import { Disclaimer, FreshnessPill, SyntheticBadge } from '@/components/status'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { StateView } from '@/components/ui/misc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { VitalTile } from '@/components/VitalTile'
import { Waveform, type Trace } from '@/components/Waveform'
import { api } from '@/lib/api'
import { can, useAuth } from '@/lib/auth'
import { fmt } from '@/lib/format'
import { freshness, getBuffers, useLive } from '@/lib/live/store'
import { useAsync } from '@/lib/useAsync'

function useNow(ms = 1000) {
  const [n, setN] = useState(Date.now())
  useEffect(() => { const id = setInterval(() => setN(Date.now()), ms); return () => clearInterval(id) }, [ms])
  return n
}

function useThemeColors() {
  const [v, setV] = useState(0)
  useEffect(() => {
    const mo = new MutationObserver(() => setV((x) => x + 1))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
  }, [])
  return useMemo(() => ({
    ecg: cssColor('--signal-ecg'), red: cssColor('--signal-ppg-red'), ir: cssColor('--signal-ppg-ir'),
    x: cssColor('--signal-imu-x'), y: cssColor('--signal-imu-y'), z: cssColor('--signal-imu-z'), mag: cssColor('--signal-imu-mag'),
  }), [v]) // eslint-disable-line react-hooks/exhaustive-deps
}

export default function Live() {
  const { current, devices, devicesLoading, devicesError, reloadDevices } = useOutletContext<ShellCtx>()
  const role = useAuth((s) => s.role)
  const navigate = useNavigate()
  const id = current?.id
  const conn = useLive((s) => s.conn)
  const d = useLive((s) => (id ? s.devices[id] : undefined))
  const watch = useLive((s) => s.watch)
  const unwatch = useLive((s) => s.unwatch)
  const now = useNow(1000)
  const colors = useThemeColors()
  const [ackTarget, setAckTarget] = useState<MespEvent | null>(null)

  useEffect(() => {
    if (!id) return
    watch(id)
    return () => unwatch(id)
  }, [id, watch, unwatch])

  const recent = useAsync(() => (id ? api.events({ device_id: id, limit: 8 }) : Promise.resolve(null)), [id], { refreshMs: 15000 })
  const events = useMemo(() => {
    const live = d?.events ?? []
    const past = recent.data?.items ?? []
    const seen = new Set(live.map((e) => e.id))
    return [...live, ...past.filter((e) => !seen.has(e.id))].sort((a, b) => b.t - a.t).slice(0, 8)
  }, [d?.events, recent.data])

  const b = id ? getBuffers(id) : null
  const ecgTraces = useMemo<Trace[]>(() => (b ? [{ ring: b.ecg, channel: 0, color: colors.ecg, label: 'ECG', width: 1.6 }] : []), [b, colors])
  const plethTraces = useMemo<Trace[]>(() => (b ? [{ ring: b.pleth, channel: 0, color: colors.ir, label: 'Pleth (IR)', width: 1.8 }] : []), [b, colors])
  const rawTraces = useMemo<Trace[]>(() => (b ? [
    { ring: b.ppgRaw, channel: 0, color: colors.red, label: 'Red' }, { ring: b.ppgRaw, channel: 1, color: colors.ir, label: 'IR' }] : []), [b, colors])
  const accTraces = useMemo<Trace[]>(() => (b ? [
    { ring: b.accel, channel: 0, color: colors.x, label: 'ax' }, { ring: b.accel, channel: 1, color: colors.y, label: 'ay' },
    { ring: b.accel, channel: 2, color: colors.z, label: 'az' }, { ring: b.accel, channel: 3, color: colors.mag, label: '|a|', width: 2 }] : []), [b, colors])
  const gyroTraces = useMemo<Trace[]>(() => (b ? [
    { ring: b.gyro, channel: 0, color: colors.x, label: 'gx' }, { ring: b.gyro, channel: 1, color: colors.y, label: 'gy' },
    { ring: b.gyro, channel: 2, color: colors.z, label: 'gz' }] : []), [b, colors])

  if (devicesError) return <StateView kind="error" title="Could not load devices" body={devicesError} action="Retry" onAction={reloadDevices} />
  if (devicesLoading && !devices.length) return <LiveSkeleton />
  if (!current) {
    return (
      <StateView kind="empty" title="No devices yet"
        body="Pair your MESP wristband, or start a demo scenario to explore the platform with clearly labelled synthetic data."
        action={can(role, 'operator') ? 'Start a demo scenario' : undefined} onAction={() => navigate('/app/demo')} />
    )
  }

  const everSeen = !!current.last_seen
  const state = freshness(conn, d, everSeen, now)
  const v = d?.vitals
  const stale = state !== 'LIVE'
  const stats = v?.stats ?? d?.status?.stats
  const profile = current.profile
  const leadOff = v?.ecg_lead_off

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-xl font-semibold tracking-tight">{current.name}</h1>
        <FreshnessPill state={state} />
        {(d?.synthetic || current.simulated) && <SyntheticBadge />}
        <span className="text-xs text-muted">
          {d?.status?.source ?? (current.online ? 'streaming' : `last seen ${fmt.ago(current.last_seen)}`)}
          {v?.t ? ` · updated ${fmt.time(v.t)}` : ''}
        </span>
        <div className="ml-auto flex gap-2">
          {d?.sessionId && <Button size="sm" variant="outline" onClick={() => navigate(`/app/history/${d.sessionId}`)}>Open session</Button>}
        </div>
      </div>

      {state === 'NO DATA' && (
        <Card><StateView kind="offline" title="This device has not streamed yet"
          body={<>Start the gateway with this device’s ingest key. See <Link className="text-primary underline" to={`/app/devices/${current.id}`}>device setup</Link>.</>} /></Card>
      )}
      {state === 'ERROR' && <Card><StateView kind="error" title="Live stream unavailable" body="Your session may have expired." action="Sign in again" onAction={() => navigate('/login')} /></Card>}

      <section aria-label="Vital signs" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <VitalTile label="HR · ECG" icon={<HeartPulse className="h-3.5 w-3.5" />} accent={colors.ecg} stale={stale}
          value={fmt.num(v?.hr_ecg)} unit="bpm" quality={v?.ecg_quality}
          sub={leadOff ? <span className="text-critical">Electrodes off</span> : v?.rr_ms ? `RR ${fmt.num(v.rr_ms)} ms` : 'R-peak detection'} />
        <VitalTile label="Pulse · PPG" icon={<Waves className="h-3.5 w-3.5" />} accent={colors.ir} stale={stale}
          value={fmt.num(v?.hr_ppg)} unit="bpm" quality={v?.ppg_quality}
          sub={v?.perfusion_index != null ? `Perfusion index ${fmt.num(v.perfusion_index, 2)} %` : 'Optical pulse'} />
        <VitalTile label="SpO₂ est." icon={<Droplets className="h-3.5 w-3.5" />} accent={colors.red} stale={stale}
          value={fmt.num(v?.spo2)} unit="%" quality={v?.ppg_quality}
          hint="Ratio-of-ratios with the firmware's placeholder line SpO₂ = 110 − 25·R. Uncalibrated: needs a device-specific calibration against a reference oximeter."
          sub={v?.spo2 == null && v?.ppg_quality === 'poor' ? 'Withheld: poor signal or motion' : 'Uncalibrated'} />
        <VitalTile label="Rhythm" icon={<Activity className="h-3.5 w-3.5" />} stale={stale}
          value={v?.rr_irregularity == null ? '—' : v.rr_irregularity > 0.12 ? 'Irregular' : 'Regular'}
          hint="RMSSD / mean RR over the last 30 beats. A signal-pattern flag, not a diagnosis."
          sub={v?.rr_irregularity != null ? `Variability ${fmt.num(v.rr_irregularity, 2)}` : 'Needs ~30 beats'} />
        <VitalTile label="Motion" icon={<Move3d className="h-3.5 w-3.5" />} stale={stale}
          value={v?.activity ? v.activity[0].toUpperCase() + v.activity.slice(1) : '—'}
          sub={v?.motion_g != null ? `${fmt.num(v.motion_g, 3)} g · roll ${fmt.num(v.roll_deg)}° pitch ${fmt.num(v.pitch_deg)}°` : 'IMU'} />
        <VitalTile label="Battery" icon={<BatteryMedium className="h-3.5 w-3.5" />} stale={stale}
          value={fmt.num(v?.battery_soc)} unit="%"
          unavailable={v?.battery_soc == null ? (profile.has_battery ? 'No battery report yet.' : 'Current firmware has no MAX17048 fuel-gauge driver.') : undefined}
          sub="Fuel gauge (proposed status line)" />
      </section>

      <Card>
        <CardHeader icon={<HeartPulse className="h-4 w-4 text-ecg" />} title="ECG"
          subtitle={`AD8232 · ${profile.ecg_hz} Hz device rate, displayed at 250 Hz · 0.5–40 Hz + ${50} Hz notch · amplitude not calibrated`}
          action={<>{v?.ecg_quality && <Badge tone={v.ecg_quality === 'good' ? 'ok' : v.ecg_quality === 'fair' ? 'warning' : 'critical'}>Signal {v.ecg_quality}</Badge>}</>} />
        <CardBody className="relative">
          <Waveform traces={ecgTraces} title="ECG waveform" grid="ecg" height={220} defaultWindow={5} minSpan={60}
            emptyHint={state === 'LIVE' || state === 'LOADING' ? 'Waiting for ECG samples…' : 'No ECG data'} />
          {leadOff && (
            <div role="alert" className="pointer-events-none absolute inset-x-8 top-6 rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-center text-xs font-medium text-critical backdrop-blur">
              Leads off — the AD8232 output is at the rail. Check electrode contact.
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <Tabs defaultValue="pleth">
            <CardHeader icon={<Waves className="h-4 w-4 text-ppg-ir" />} title="PPG"
              subtitle={`MAX30102 · ${profile.ppg_fifo_hz} Hz FIFO · ${profile.ppg_adc_bits}-bit`}
              action={<TabsList aria-label="PPG view"><TabsTrigger value="pleth">Pleth</TabsTrigger><TabsTrigger value="raw">Red / IR</TabsTrigger></TabsList>} />
            <CardBody>
              <TabsContent value="pleth"><Waveform traces={plethTraces} title="Plethysmogram (IR, band-passed)" defaultWindow={10} windows={[5, 10, 20, 40]} height={170} minSpan={50} /></TabsContent>
              <TabsContent value="raw"><Waveform traces={rawTraces} title="Raw red and IR photodiode counts" unit="ADC code" defaultWindow={10} windows={[5, 10, 20, 40]} height={170} /></TabsContent>
              <Legend items={[['Red', colors.red], ['IR', colors.ir]]} />
            </CardBody>
          </Tabs>
        </Card>
        <Card>
          <Tabs defaultValue="accel">
            <CardHeader icon={<Move3d className="h-4 w-4 text-imu-x" />} title="Motion"
              subtitle={`MPU-6886 · ${profile.imu_hz} Hz device rate, displayed at 50 Hz · ±${(32768 / profile.accel_lsb_per_g).toFixed(0)} g`}
              action={<TabsList aria-label="Motion view"><TabsTrigger value="accel">Accel</TabsTrigger><TabsTrigger value="gyro">Gyro</TabsTrigger></TabsList>} />
            <CardBody>
              <TabsContent value="accel"><Waveform traces={accTraces} title="Acceleration" unit="g" defaultWindow={10} windows={[5, 10, 20, 40]} height={170} minSpan={0.2} /></TabsContent>
              <TabsContent value="gyro"><Waveform traces={gyroTraces} title="Angular rate" unit="deg/s" defaultWindow={10} windows={[5, 10, 20, 40]} height={170} minSpan={5} /></TabsContent>
              <Legend items={[['x', colors.x], ['y', colors.y], ['z', colors.z], ['|a|', colors.mag]]} />
            </CardBody>
          </Tabs>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader icon={<Radio className="h-4 w-4 text-primary" />} title="Link" subtitle="Measured by the platform for this session" />
          <CardBody>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
              <Stat k="Link state" v={d?.link ?? '—'} />
              <Stat k="Frames OK" v={fmt.int(stats?.frames_ok)} />
              <Stat k="Lost frames" v={fmt.int(stats?.lost_frames)} hint="From gaps in the firmware's 8-bit sequence counter (a lower bound across long outages)." />
              <Stat k="CRC errors" v={fmt.int(stats?.crc_errors)} />
              <Stat k="Loss (10 s)" v={v?.link?.loss_ratio == null ? '—' : fmt.pct(v.link.loss_ratio)} />
              <Stat k="Duplicates" v={fmt.int(stats?.duplicates)} />
              <Stat k="Latency p50" v={stats?.latency_ms_p50 == null ? '—' : `${stats.latency_ms_p50} ms`} hint="Gateway receive → API processing. Excludes the BLE air time, which is not measured." />
              <Stat k="Latency p95" v={stats?.latency_ms_p95 == null ? '—' : `${stats.latency_ms_p95} ms`} />
              <Stat k="Data" v={fmt.bytes(stats?.bytes)} />
              <Stat k="IMU die temp" v={v?.imu_temp_c != null ? `${fmt.num(v.imu_temp_c, 1)} °C` : '—'} hint="MPU-6886 internal temperature. Not body or skin temperature." />
              <Stat k="Skin temp" v={v?.skin_temp_c != null ? `${fmt.num(v.skin_temp_c, 1)} °C` : 'N/A'} hint="MAX30205 driver is not in the current firmware." />
              <Stat k="Timestamp gaps" v={fmt.int(stats?.clock_gaps)} />
            </dl>
            {d?.linkReason && <p className="mt-3 text-[11px] text-muted">Last link change: {d.linkReason}</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent events" action={<Button size="sm" variant="ghost" onClick={() => navigate('/app/events')}>View all</Button>} />
          <CardBody className="px-2 sm:px-3">
            {events.length === 0 ? (
              <StateView compact kind="empty" title="No events" body="Events appear here when a rule fires (e.g. lead-off, low SpO₂ estimate, packet loss)." />
            ) : (
              <ul className="space-y-1">{events.map((e) => <EventRow key={e.id} e={e} compact onAck={can(role, 'operator') ? setAckTarget : undefined} />)}</ul>
            )}
          </CardBody>
        </Card>
      </div>
      <Disclaimer className="pt-2" />
      <AckDialog event={ackTarget} onClose={() => setAckTarget(null)} onDone={() => recent.reload()} />
    </div>
  )
}

function Stat({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div title={hint}>
      <dt className="text-[11px] text-muted">{k}</dt>
      <dd className="font-mono text-sm tabular-nums">{v}</dd>
    </div>
  )
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted" aria-hidden>
      {items.map(([l, c]) => <span key={l} className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: c }} />{l}</span>)}
    </div>
  )
}

function LiveSkeleton() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-64 animate-pulse rounded-md bg-surface-2" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-lg bg-surface-2" />)}</div>
      <div className="h-64 animate-pulse rounded-lg bg-surface-2" />
    </div>
  )
}
