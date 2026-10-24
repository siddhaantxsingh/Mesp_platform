// Minimal typings for the two browser APIs used to reach the wristband.
// Web Bluetooth: Chrome/Edge on Windows, macOS, ChromeOS, Android (Linux: behind a Chrome flag).
// Web Serial:    Chrome/Edge on desktop only.

interface MespBluetoothCharacteristic extends EventTarget {
  value?: DataView
  startNotifications(): Promise<MespBluetoothCharacteristic>
  stopNotifications(): Promise<MespBluetoothCharacteristic>
}
interface MespBluetoothService { getCharacteristic(uuid: string): Promise<MespBluetoothCharacteristic> }
interface MespGattServer {
  connected: boolean
  connect(): Promise<MespGattServer>
  disconnect(): void
  getPrimaryService(uuid: string): Promise<MespBluetoothService>
}
interface MespBluetoothDevice extends EventTarget { id: string; name?: string; gatt?: MespGattServer }
interface MespBluetooth {
  getAvailability?(): Promise<boolean>
  requestDevice(options: {
    filters?: { name?: string; namePrefix?: string; services?: string[] }[]
    optionalServices?: string[]
    acceptAllDevices?: boolean
  }): Promise<MespBluetoothDevice>
}

interface MespSerialPort extends EventTarget {
  readable: ReadableStream<Uint8Array> | null
  open(options: { baudRate: number; bufferSize?: number }): Promise<void>
  close(): Promise<void>
  getInfo(): { usbVendorId?: number; usbProductId?: number }
}
interface MespSerial extends EventTarget {
  requestPort(options?: { filters?: { usbVendorId?: number; usbProductId?: number }[] }): Promise<MespSerialPort>
}

interface Navigator {
  bluetooth?: MespBluetooth
  serial?: MespSerial
}
