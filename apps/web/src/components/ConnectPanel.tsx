import { useMemo, useState } from 'react'
import { Bluetooth, Cable, Loader2, Unplug } from 'lucide-react'
import type { Device } from '@mesp/types'
import { can, useAuth } from '@/lib/auth'
import { linkSupport } from '@/lib/device-link/sources'
import { useDeviceLink } from '@/lib/device-link/store'
import { fmt } from '@/lib/format'
import { Button } from './ui/button'
import { Card, CardBody, CardHeader } from './ui/card'

/**
 * "Connect your wristband": Bluetooth or USB cable, straight from the browser.
 * Data then flows browser -> server -> every open dashboard, exactly like the gateway program.
 */
export function ConnectPanel({ device }: { device: Device }) {
  const role = useAuth((s) => s.role)
  const demo = useAuth((s) => s.demo)
  const { snap, busy, error, connect, disconnect, clearError, link } = useDeviceLink()
  const support = useMemo(() => linkSupport(), [])
  const [showHelp, setShowHelp] = useState(false)

  if (device.simulated) return null
  const mine = !!link && snap?.deviceId === device.id
  const active = mine && snap && (snap.phase === 'streaming' || snap.phase === 'connecting' || snap.phase === 'reconnecting')
  const allowed = can(role, 'operator') && !demo

  return (
    <Card aria-label="Connect your wristband">
      <CardHeader icon={<Bluetooth className="h-4 w-4 text-primary" />} title="Connect your wristband"
        subtitle={active ? `Connected by ${snap!.kind === 'bluetooth' ? 'Bluetooth' : 'USB cable'} (${snap!.label})`
          : 'Bluetooth, or a USB cable plugged into the nRF board. Use Chrome or Edge.'} />
      <CardBody className="space-y-3">
        {!allowed ? (
          <p className="text-sm text-muted">
            {demo ? 'The demo login cannot stream a real band. Sign in with your team account to connect.' : 'Your account can view data but not connect devices (operator role needed).'}
          </p>
        ) : active ? (
          <div className="space-y-3">
            <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-2 text-sm">
              {snap!.phase === 'streaming'
                ? <span className="inline-flex items-center gap-1.5 font-medium text-ok"><span className="h-2 w-2 animate-pulse rounded-full bg-ok" />{snap!.message}</span>
                : <span className="inline-flex items-center gap-1.5 text-warning"><Loader2 className="h-3.5 w-3.5 animate-spin" />{snap!.message}</span>}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
              <Item k="Data rate" v={`${fmt.num(snap!.bytesPerSec / 1024, 1)} kB/s`} />
              <Item k="Packets received" v={fmt.int(snap!.frames)} />
              <Item k="Damaged packets" v={fmt.int(snap!.crcErrors)} hint="Packets whose checksum did not match (dropped and counted)." />
              <Item k="Waiting to send" v={fmt.int(snap!.queued)} hint="Packets kept while the server connection is down." />
            </dl>
            <Button variant="outline" size="sm" onClick={() => void disconnect()} loading={busy}>
              <Unplug className="mr-1.5 h-4 w-4" />Disconnect
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <ChoiceButton icon={<Bluetooth className="h-5 w-5" />} title="Connect by Bluetooth"
                body={`Pick “MESP-Health” in the list that opens.`}
                disabled={!support.bluetooth || busy} why={support.bluetoothWhy}
                onClick={() => { clearError(); void connect('bluetooth', device.id) }} />
              <ChoiceButton icon={<Cable className="h-5 w-5" />} title="Connect by USB cable"
                body="Plug the cable into the nRF (XIAO) board, then pick its port."
                disabled={!support.usb || busy} why={support.usbWhy}
                onClick={() => { clearError(); void connect('usb', device.id) }} />
            </div>
            {busy && <p className="inline-flex items-center gap-1.5 text-sm text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />Connecting…</p>}
            {mine && snap?.phase === 'stopped' && snap.message !== 'Disconnected' && <p role="alert" className="text-sm text-warning">{snap.message}</p>}
            {error && <p role="alert" className="text-sm text-critical">{error}</p>}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {support.usb && (
                <button type="button" className="text-primary underline-offset-2 hover:underline" disabled={busy}
                  onClick={() => { clearError(); void connect('usb', device.id, { anyPort: true }) }}>
                  Board not in the USB list? Show all ports
                </button>
              )}
              <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => setShowHelp((x) => !x)} aria-expanded={showHelp}>
                {showHelp ? 'Hide help' : 'Not working?'}
              </button>
            </div>
            {showHelp && (
              <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted">
                <li>The band must run the firmware with <code>NRF_LINK_ENABLED 1</code>, and the nRF board must run <code>ble_uart_bridge</code>.</li>
                <li>nRF lights: blue blinking = waiting for Bluetooth, blue steady = connected, green flickering = data arriving from the band.</li>
                <li>Only one connection at a time: close the Arduino Serial Monitor and any other tab or program that is streaming this band.</li>
                <li>After Bluetooth drops, the nRF can take up to ~20 s before it shows up again. Reset the nRF board to skip the wait.</li>
                <li>Linux: Bluetooth in Chrome needs <code>chrome://flags</code> → “Experimental Web Platform features”. USB may need permission: <code>sudo usermod -aG dialout $USER</code>, then log out and in.</li>
                <li>Phone: use Bluetooth (the USB cable option is for computers).</li>
              </ul>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function ChoiceButton({ icon, title, body, disabled, why, onClick }: {
  icon: React.ReactNode; title: string; body: string; disabled: boolean; why?: string; onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="flex items-start gap-3 rounded-lg border border-border bg-surface-2 p-3 text-left transition hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60">
      <span className="mt-0.5 text-primary">{icon}</span>
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted">{why ?? body}</span>
      </span>
    </button>
  )
}

function Item({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div title={hint}>
      <dt className="text-[11px] text-muted">{k}</dt>
      <dd className="font-mono text-sm tabular-nums">{v}</dd>
    </div>
  )
}
