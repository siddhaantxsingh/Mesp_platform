/**
 * Byte sources for the wristband, opened from the browser.
 *
 * The XIAO nRF52840 bridge (MESP_lab nrf52840_firmware/ble_uart_bridge.ino) forwards the
 * STM32's framed stream UNCHANGED to two outputs at the same time:
 *   - Bluetooth LE: Nordic UART Service, advertised as "MESP-Health"; data arrives as
 *     notifications on the TX characteristic (6e400003-…).
 *   - USB cable: the XIAO's own USB serial port (CDC). The baud-rate setting is ignored by USB.
 * Both deliver the same bytes, so everything after this file is shared.
 */

export type LinkKind = 'bluetooth' | 'usb'

export const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
export const NUS_TX_CHAR = '6e400003-b5a3-f393-e0a9-e50e24dcca9e' // peripheral -> browser (notify)
export const BLE_NAME = 'MESP-Health'
/** Seeed Studio USB vendor id (XIAO nRF52840). */
export const SEEED_USB_VENDOR = 0x2886

export interface SourceCallbacks {
  onBytes: (chunk: Uint8Array, rxTime: number) => void
  /** The link ended without the user asking (cable pulled, out of Bluetooth range, board reset). */
  onLost: (reason: string) => void
}

export interface ByteSource {
  kind: LinkKind
  /** Human-readable name, e.g. "MESP-Health" or "USB 2886:8045". */
  label: string
  start(cb: SourceCallbacks): Promise<void>
  stop(): Promise<void>
}

export interface Support { bluetooth: boolean; usb: boolean; bluetoothWhy?: string; usbWhy?: string }

/** What this browser can do, with a plain-language reason when it cannot. */
export function linkSupport(nav: Navigator = navigator, secure = typeof window !== 'undefined' ? window.isSecureContext : true): Support {
  const insecure = 'Open the website over https (or on localhost) to connect a device.'
  const mobile = /Android|iPhone|iPad/i.test(nav.userAgent)
  return {
    bluetooth: secure && !!nav.bluetooth,
    // Newer Chrome on Android has navigator.serial, but only for Bluetooth serial, never USB cables.
    usb: secure && !!nav.serial && !mobile,
    bluetoothWhy: !secure ? insecure : nav.bluetooth ? undefined
      : /Linux/i.test(nav.userAgent) && !mobile
        ? 'On Linux, turn on Bluetooth in Chrome first: open chrome://flags, enable "Experimental Web Platform features", restart Chrome.'
        : 'Bluetooth needs Google Chrome or Microsoft Edge.',
    usbWhy: !secure ? insecure
      : mobile ? 'The USB cable option works on a computer, not on a phone. Use Bluetooth on the phone.'
      : nav.serial ? undefined
        : 'The USB cable option needs Google Chrome or Microsoft Edge on a computer.',
  }
}

// ------------------------------------------------------------------ Bluetooth

export class BluetoothSource implements ByteSource {
  kind = 'bluetooth' as const
  label = BLE_NAME
  private device: MespBluetoothDevice | null = null
  private ch: MespBluetoothCharacteristic | null = null
  private stopping = false
  private onValue = (ev: Event) => {
    const v = (ev.target as MespBluetoothCharacteristic).value
    if (v) this.cb?.onBytes(new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)), Date.now() / 1000)
  }
  private onGone = () => { if (!this.stopping) this.cb?.onLost('Bluetooth connection lost (out of range, or the band was switched off or reset)') }
  private cb: SourceCallbacks | null = null

  constructor(private nav: Navigator = navigator) {}

  /** Must be called from a click (the browser shows its device chooser). */
  async request(): Promise<void> {
    if (!this.nav.bluetooth) throw new Error('Bluetooth is not available in this browser.')
    this.device = await this.nav.bluetooth.requestDevice({
      filters: [{ namePrefix: 'MESP' }, { services: [NUS_SERVICE] }],
      optionalServices: [NUS_SERVICE],
    })
    this.label = this.device.name || BLE_NAME
  }

  async start(cb: SourceCallbacks): Promise<void> {
    if (!this.device?.gatt) throw new Error('No Bluetooth device chosen.')
    this.cb = cb
    this.stopping = false
    this.device.addEventListener('gattserverdisconnected', this.onGone)
    const server = await this.device.gatt.connect()
    const svc = await server.getPrimaryService(NUS_SERVICE)
    this.ch = await svc.getCharacteristic(NUS_TX_CHAR)
    this.ch.addEventListener('characteristicvaluechanged', this.onValue)
    await this.ch.startNotifications()
  }

  async stop(): Promise<void> {
    this.stopping = true
    try { await this.ch?.stopNotifications() } catch { /* already gone */ }
    this.ch?.removeEventListener('characteristicvaluechanged', this.onValue)
    this.device?.removeEventListener('gattserverdisconnected', this.onGone)
    if (this.device?.gatt?.connected) this.device.gatt.disconnect()
    this.ch = null
  }
}

// ------------------------------------------------------------------ USB cable (Web Serial)

export class UsbSource implements ByteSource {
  kind = 'usb' as const
  label = 'USB cable'
  private port: MespSerialPort | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private stopping = false
  private done: Promise<void> | null = null

  constructor(private nav: Navigator = navigator) {}

  /** Must be called from a click (the browser shows its port chooser). `anyPort` lists every serial port. */
  async request(anyPort = false): Promise<void> {
    if (!this.nav.serial) throw new Error('The USB cable option is not available in this browser.')
    this.port = await this.nav.serial.requestPort(anyPort ? {} : { filters: [{ usbVendorId: SEEED_USB_VENDOR }] })
    const info = this.port.getInfo()
    this.label = info.usbVendorId != null
      ? `USB ${info.usbVendorId.toString(16).padStart(4, '0')}:${(info.usbProductId ?? 0).toString(16).padStart(4, '0')}`
      : 'USB cable'
  }

  async start(cb: SourceCallbacks): Promise<void> {
    if (!this.port) throw new Error('No USB port chosen.')
    this.stopping = false
    // USB CDC ignores the baud rate; 1 Mbaud matches the STM32 link for USB-UART adapters.
    await this.port.open({ baudRate: 1_000_000, bufferSize: 64 * 1024 })
    if (!this.port.readable) throw new Error('The USB port cannot be read.')
    this.reader = this.port.readable.getReader()
    const reader = this.reader
    this.done = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          if (value?.length) cb.onBytes(value, Date.now() / 1000)
        }
        if (!this.stopping) cb.onLost('USB cable disconnected')
      } catch {
        if (!this.stopping) cb.onLost('USB cable disconnected (or the board was reset)')
      } finally {
        try { reader.releaseLock() } catch { /* ignore */ }
      }
    })()
  }

  async stop(): Promise<void> {
    this.stopping = true
    try { await this.reader?.cancel() } catch { /* ignore */ }
    try { await this.done } catch { /* ignore */ }
    try { await this.port?.close() } catch { /* ignore */ }
    this.reader = null
  }
}
