/**
 * One wristband connection per browser tab, kept outside React so it survives page changes
 * (Live -> History -> Events) while the band keeps streaming.
 */
import { create } from 'zustand'
import { useAuth } from '../auth'
import { browserIngestWsUrl } from '../config'
import { BluetoothSource, UsbSource, type LinkKind } from './sources'
import { DeviceLink, type LinkSnapshot } from './uplink'

interface DeviceLinkState {
  link: DeviceLink | null
  snap: LinkSnapshot | null
  busy: boolean
  error: string | null
  connect: (kind: LinkKind, deviceId: string, opts?: { anyPort?: boolean }) => Promise<void>
  disconnect: () => Promise<void>
  clearError: () => void
}

const cancelled = (e: unknown) => {
  const n = (e as { name?: string })?.name
  return n === 'NotFoundError' || n === 'AbortError' || /cancel|no device selected|no port selected/i.test(String((e as Error)?.message))
}

export const useDeviceLink = create<DeviceLinkState>((set, get) => ({
  link: null,
  snap: null,
  busy: false,
  error: null,
  clearError: () => set({ error: null }),

  async connect(kind, deviceId, opts = {}) {
    if (get().busy) return
    set({ busy: true, error: null })
    try {
      // The browser's chooser must open straight from the click, so it comes before any other await.
      const src = kind === 'bluetooth' ? new BluetoothSource() : new UsbSource()
      if (src instanceof UsbSource) await src.request(opts.anyPort)
      else await src.request()
      await get().link?.stop().catch(() => undefined)
      set({ link: null, snap: null })
      const link = new DeviceLink({
        source: src, deviceId, url: browserIngestWsUrl(),
        getToken: () => useAuth.getState().token,
        onChange: (snap) => set({ snap }),
      })
      set({ link })
      await link.start()
    } catch (e) {
      const snap = get().snap
      if (cancelled(e)) set({ link: null, snap: null })
      else set({ error: snap?.phase === 'error' ? snap.message : friendly(kind, e) })
    } finally {
      set({ busy: false })
    }
  },

  async disconnect() {
    const l = get().link
    set({ busy: true })
    try { await l?.stop() } finally { set({ busy: false, link: null }) }
  },
}))

function friendly(kind: LinkKind, e: unknown): string {
  const msg = (e as Error)?.message || String(e)
  const name = (e as { name?: string })?.name
  if (kind === 'usb' && (name === 'InvalidStateError' || /already open/i.test(msg)))
    return 'The USB port is already in use. Close the Arduino Serial Monitor or any other program using the board, then try again.'
  if (kind === 'usb' && (name === 'NetworkError' || /failed to open/i.test(msg)))
    return 'Could not open the USB port. Unplug and replug the cable, close other programs using the board, then try again.'
  if (kind === 'bluetooth' && /GATT|connect/i.test(msg))
    return 'Could not connect over Bluetooth. Make sure the band is on and close by (its blue light should be blinking), then try again.'
  return msg
}
