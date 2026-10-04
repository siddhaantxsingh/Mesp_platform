import { useEffect, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { Bluetooth, Check, Copy, Cpu, KeyRound, Plus, RefreshCw, Trash2, Usb } from 'lucide-react'
import type { Device, DeviceProfile } from '@mesp/types'
import type { ShellCtx } from '@/components/AppShell'
import { SyntheticBadge } from '@/components/status'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { StateView } from '@/components/ui/misc'
import { api } from '@/lib/api'
import { can, useAuth } from '@/lib/auth'
import { fmt } from '@/lib/format'
import { useUi } from '@/lib/ui'
import { useAsync } from '@/lib/useAsync'
import { cn } from '@/lib/utils'

export default function Devices() {
  const { devices, devicesLoading, devicesError, reloadDevices } = useOutletContext<ShellCtx>()
  const { role, demo } = useAuth()
  const [pairing, setPairing] = useState(false)
  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Devices</h1>
        {can(role, 'operator') && <Button className="ml-auto" variant="primary" size="sm" onClick={() => setPairing(true)}><Plus className="h-4 w-4" />Pair device</Button>}
      </div>
      {devicesError ? <StateView kind="error" title="Could not load devices" body={devicesError} action="Retry" onAction={reloadDevices} /> :
        devicesLoading && !devices.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-44 animate-pulse rounded-lg bg-surface-2" />)}</div> :
          !devices.length ? <StateView kind="empty" title="No devices" body="Pair a MESP wristband to start streaming." action={can(role, 'operator') ? 'Pair device' : undefined} onAction={() => setPairing(true)} /> : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{devices.map((d) => <DeviceCard key={d.id} d={d} />)}</div>
          )}
      <PairDialog open={pairing} onClose={() => { setPairing(false); reloadDevices() }} demo={demo} />
    </div>
  )
}

function DeviceCard({ d }: { d: Device }) {
  const st = d.live?.stats
  return (
    <Link to={`/app/devices/${d.id}`} className="group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="h-full transition-colors group-hover:border-primary/40">
        <CardHeader icon={<Cpu className="h-4 w-4 text-muted" />} title={d.name} subtitle={d.firmware ?? d.profile_id}
          action={d.online ? <Badge tone="ok">online</Badge> : <Badge>offline</Badge>} />
        <CardBody>
          <div className="mb-3 flex flex-wrap gap-1.5">{d.simulated && <SyntheticBadge />}<Badge tone="neutral">key {d.key_prefix}…</Badge></div>
          <dl className="grid grid-cols-3 gap-2 text-xs">
            <div><dt className="text-muted">Frames</dt><dd className="font-mono">{fmt.int(st?.frames_ok)}</dd></div>
            <div><dt className="text-muted">Lost</dt><dd className="font-mono">{fmt.int(st?.lost_frames)}</dd></div>
            <div><dt className="text-muted">CRC</dt><dd className="font-mono">{fmt.int(st?.crc_errors)}</dd></div>
          </dl>
          <p className="mt-3 text-[11px] text-muted">Last seen {fmt.ago(d.last_seen)}</p>
        </CardBody>
      </Card>
    </Link>
  )
}

function Copyable({ text, label }: { text: string; label: string }) {
  const [ok, setOk] = useState(false)
  return (
    <div className="flex items-stretch overflow-hidden rounded-md border border-border bg-background">
      <code className="flex-1 overflow-x-auto whitespace-pre px-3 py-2 font-mono text-[11px] leading-relaxed">{text}</code>
      <button aria-label={`Copy ${label}`} onClick={async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500) } catch { /* clipboard blocked */ } }}
        className="border-l border-border px-2.5 text-muted hover:bg-surface-2 hover:text-foreground">{ok ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />}</button>
    </div>
  )
}

function PairDialog({ open, onClose, demo }: { open: boolean; onClose: () => void; demo: boolean }) {
  const nav = useNavigate()
  const setDevice = useUi((s) => s.setDevice)
  const [step, setStep] = useState(0)
  const [name, setName] = useState('My MESP wristband')
  const [profile, setProfile] = useState('mesp-lab-main-v1')
  const [created, setCreated] = useState<Device | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [transport, setTransport] = useState<'ble' | 'serial'>('ble')
  const meta = useAsync(() => api.meta(), [])
  const online = useAsync(() => (created ? api.device(created.id) : Promise.resolve(null)), [created?.id], { refreshMs: step === 2 ? 2000 : undefined, enabled: step === 2 })

  useEffect(() => { if (!open) { setStep(0); setCreated(null); setErr(null) } }, [open])
  const p = meta.data?.profiles.find((x) => x.id === profile)

  const create = async () => {
    setBusy(true); setErr(null)
    try { setCreated(await api.createDevice(name, profile)); setStep(1) } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } finally { setBusy(false) }
  }
  const key = created?.ingest_key ?? ''
  const cmd = transport === 'ble'
    ? `export MESP_DEVICE_KEY='${key}'\nmesp-gateway --source ble --ble-name MESP-Health \\\n  --api ws://<api-host>:8000/api/v1/ingest/ws`
    : `export MESP_DEVICE_KEY='${key}'\nmesp-gateway --source serial --port /dev/ttyUSB0 --baud 1000000 \\\n  --api ws://<api-host>:8000/api/v1/ingest/ws`

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Pair a MESP device" className="max-w-xl"
      description={['Register the device and choose the firmware profile.', 'Configure the gateway with the ingest key.', 'Waiting for the first data.'][step]}>
      <ol className="mb-4 flex gap-1.5" aria-label="Pairing steps">
        {['Register', 'Gateway', 'Verify'].map((l, i) => (
          <li key={l} className={cn('flex-1 rounded-full py-1 text-center text-[11px] font-medium', i <= step ? 'bg-primary/15 text-primary' : 'bg-surface-2 text-muted')} aria-current={i === step ? 'step' : undefined}>{i + 1}. {l}</li>
        ))}
      </ol>
      {demo ? (
        <StateView compact kind="empty" title="Not available in the demo" body="Demo accounts can run scenarios but cannot register hardware. Sign in with an operator account to pair a real device." />
      ) : step === 0 ? (
        <div className="space-y-3">
          <div>
            <label htmlFor="dev-name" className="text-xs font-medium">Device name</label>
            <input id="dev-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120}
              className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div>
            <label htmlFor="dev-profile" className="text-xs font-medium">Firmware profile</label>
            <select id="dev-profile" value={profile} onChange={(e) => setProfile(e.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              {meta.data?.profiles.map((x) => <option key={x.id} value={x.id}>{x.id}</option>)}
            </select>
            {p && <ProfileFacts p={p} className="mt-2" />}
          </div>
          {err && <p role="alert" className="text-xs text-critical">{err}</p>}
          <div className="flex justify-end"><Button variant="primary" onClick={create} loading={busy} disabled={!name.trim()}>Register</Button></div>
        </div>
      ) : step === 1 ? (
        <div className="space-y-3">
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning"><KeyRound className="mr-1 inline h-3.5 w-3.5" />This ingest key is shown <b>once</b>. Store it in the gateway environment; never commit it.</div>
          <Copyable text={key} label="ingest key" />
          <div className="flex gap-2">
            <Button size="sm" variant={transport === 'ble' ? 'primary' : 'outline'} onClick={() => setTransport('ble')}><Bluetooth className="h-3.5 w-3.5" />BLE (nRF52840 bridge)</Button>
            <Button size="sm" variant={transport === 'serial' ? 'primary' : 'outline'} onClick={() => setTransport('serial')}><Usb className="h-3.5 w-3.5" />USB-UART bench</Button>
          </div>
          <Copyable text={cmd} label="gateway command" />
          <p className="text-[11px] leading-relaxed text-muted">
            {transport === 'ble'
              ? 'The gateway scans for the bridge advertising as “MESP-Health” and subscribes to Nordic UART Service notifications.'
              : 'Bench mode: STM32 PA9 (USART1 TX) → adapter RX, common GND. Build the firmware with NRF_LINK_ENABLED=1 and NRF_UART_HWFC=0.'}
          </p>
          <div className="flex justify-end"><Button variant="primary" onClick={() => setStep(2)}>I’ve started the gateway</Button></div>
        </div>
      ) : (
        <div className="space-y-4 text-center">
          {online.data?.online ? (
            <>
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-ok/15 text-ok"><Check className="h-7 w-7" /></div>
              <div className="text-sm font-medium">Receiving data from {online.data.name}</div>
              <Button variant="primary" onClick={() => { setDevice(online.data!.id); onClose(); nav('/app/live') }}>Open live view</Button>
            </>
          ) : (
            <>
              <div className="relative mx-auto h-16 w-16" aria-hidden>
                <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
                <span className="absolute inset-3 grid place-items-center rounded-full bg-primary/20 text-primary"><Bluetooth className="h-5 w-5" /></span>
              </div>
              <p role="status" className="text-sm">Waiting for the first frames…</p>
              <p className="text-xs text-muted">Check that the gateway reports “uplink connected”. You can close this dialog; the device stays registered.</p>
              <Button variant="ghost" onClick={onClose}>Close</Button>
            </>
          )}
        </div>
      )}
    </Dialog>
  )
}

export function ProfileFacts({ p, className }: { p: DeviceProfile; className?: string }) {
  const rows: [string, string][] = [
    ['ECG', `${p.ecg_hz} Hz, ${p.ecg_adc_bits}-bit @ ${p.ecg_vref} V`], ['PPG', `${p.ppg_fifo_hz} Hz FIFO, ${p.ppg_adc_bits}-bit`],
    ['IMU', `${p.imu_hz} Hz, ±${(32768 / p.accel_lsb_per_g).toFixed(0)} g, ±${(32768 / p.gyro_lsb_per_dps).toFixed(0)} dps`],
    ['Battery gauge', p.has_battery ? 'yes' : 'Not implemented in firmware'], ['Skin temperature', p.has_skin_temp ? 'yes' : 'Not implemented in firmware'],
    ['Display', p.has_display ? 'yes' : 'Not implemented in firmware'],
  ]
  return (
    <dl className={cn('grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-border bg-surface-2/50 p-3 text-xs', className)}>
      {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className={v.startsWith('Not') ? 'text-muted' : ''}>{v}</dd></div>)}
      <dt className="text-muted">Source</dt><dd className="font-mono text-[10px] text-muted">{p.source}</dd>
    </dl>
  )
}

export function DeviceDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const role = useAuth((s) => s.role)
  const demo = useAuth((s) => s.demo)
  const d = useAsync(() => api.device(id!), [id], { refreshMs: 3000 })
  const sessions = useAsync(() => api.sessions({ device_id: id, limit: 10 }), [id])
  const [newKey, setNewKey] = useState<string | null>(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  if (d.error) return <StateView kind="error" title="Device not found" body={d.error} action="All devices" onAction={() => nav('/app/devices')} />
  if (!d.data) return <StateView kind="loading" title="Loading device…" />
  const dev = d.data
  const st = dev.live?.stats
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{dev.name}</h1>
        {dev.online ? <Badge tone="ok">online · {dev.live?.link_state}</Badge> : <Badge>offline</Badge>}
        {dev.simulated && <SyntheticBadge />}
        <div className="ml-auto flex gap-2">
          {can(role, 'operator') && !demo && !dev.simulated && <Button size="sm" variant="outline" onClick={async () => { try { setNewKey((await api.rotateKey(dev.id)).ingest_key) } catch (e) { setErr((e as Error).message) } }}><RefreshCw className="h-3.5 w-3.5" />Rotate key</Button>}
          {can(role, 'admin') && <Button size="sm" variant="danger" onClick={() => setConfirmDel(true)}><Trash2 className="h-3.5 w-3.5" />Delete</Button>}
        </div>
      </div>
      {err && <p role="alert" className="text-xs text-critical">{err}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title="Link health" subtitle={dev.online ? `Session started ${fmt.ago(dev.live?.started_at)}` : `Last seen ${fmt.ago(dev.last_seen)}`} />
          <CardBody>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {([['Packets received', fmt.int(st?.frames_ok)], ['Packets lost', fmt.int(st?.lost_frames)], ['CRC errors', fmt.int(st?.crc_errors)], ['Duplicates', fmt.int(st?.duplicates)],
                ['Malformed', fmt.int(st?.frame_errors)], ['Bytes', fmt.bytes(st?.bytes)], ['Latency p50', st?.latency_ms_p50 != null ? `${st.latency_ms_p50} ms` : 'Not yet measured'], ['Latency p95', st?.latency_ms_p95 != null ? `${st.latency_ms_p95} ms` : 'Not yet measured']] as const)
                .map(([k, v]) => <div key={k}><dt className="text-[11px] text-muted">{k}</dt><dd className="font-mono tabular-nums">{v}</dd></div>)}
            </dl>
            {dev.live?.device_reported && <p className="mt-3 font-mono text-[11px] text-muted">Device stats line: {Object.entries(dev.live.device_reported).map(([k, v]) => `${k}=${v}`).join(' ')}</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Firmware profile" subtitle={dev.firmware ?? 'Firmware not reported yet'} />
          <CardBody><ProfileFacts p={dev.profile} /></CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title="Recent sessions" />
        <CardBody className="px-2">
          {!sessions.data?.items.length ? <StateView compact kind="empty" title="No sessions yet" /> : (
            <ul className="divide-y divide-border">
              {sessions.data.items.map((s) => (
                <li key={s.id}><Link to={`/app/history/${s.id}`} className="flex items-center justify-between gap-3 rounded px-3 py-2 text-sm hover:bg-surface-2">
                  <span>{fmt.dateTime(s.started_at)}</span><span className="font-mono text-xs text-muted">{fmt.duration(s.duration_s)} · {fmt.int(s.stats.frames_ok)} frames</span>
                </Link></li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <Dialog open={!!newKey} onOpenChange={(o) => !o && setNewKey(null)} title="New ingest key" description="The previous key stopped working immediately. Update the gateway environment.">
        <Copyable text={newKey ?? ''} label="new ingest key" />
      </Dialog>
      <Dialog open={confirmDel} onOpenChange={setConfirmDel} title={`Delete ${dev.name}?`} description="This permanently deletes the device, all its sessions, samples and events.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDel(false)}>Cancel</Button>
          <Button variant="danger" onClick={async () => { try { await api.deleteDevice(dev.id); nav('/app/devices') } catch (e) { setErr((e as Error).message); setConfirmDel(false) } }}>Delete permanently</Button>
        </div>
      </Dialog>
    </div>
  )
}
