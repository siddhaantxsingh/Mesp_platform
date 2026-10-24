/**
 * "Connect by Bluetooth" / "Connect by USB cable", end to end:
 * fake band (firmware-identical bytes) -> browser -> API -> live dashboard + alerts.
 *
 * Needs a real (non-demo) operator account: set E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD to the
 * API's MESP_ADMIN_EMAIL / MESP_ADMIN_PASSWORD. Skipped otherwise.
 * The byte stream comes from e2e/fixtures/make_stream.py (needs the Python packages installed).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

const EMAIL = process.env.E2E_ADMIN_EMAIL
const PASSWORD = process.env.E2E_ADMIN_PASSWORD
test.skip(!EMAIL || !PASSWORD, 'set E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD (a real operator account)')

let streamB64 = ''
test.beforeAll(() => {
  const out = join(test.info().project.outputDir, 'device-stream.bin')
  execFileSync('python3', [join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'make_stream.py'), out, '20'])
  streamB64 = readFileSync(out).toString('base64')
})

/** Installs navigator.bluetooth and navigator.serial fakes that replay the stream at ~real-time speed. */
async function fakeBand(page: Page) {
  await page.addInitScript((b64: string) => {
    const all = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const w = window as unknown as Record<string, unknown>
    w.__band = { bleDrop: null as null | (() => void), usbPull: null as null | (() => void) }
    const band = w.__band as { bleDrop: null | (() => void); usbPull: null | (() => void) }
    const PER_TICK = Math.ceil(all.length / 20 / 20)          // 20 s of data, 50 ms ticks
    const player = (send: (c: Uint8Array) => void) => {
      let o = 0
      const id = setInterval(() => {
        for (let k = 0; k < 4 && o < all.length; k++) {       // ~244-byte BLE-sized pieces
          const n = Math.min(Math.ceil(PER_TICK / 4), all.length - o)
          send(all.slice(o, o + n)); o += n
        }
        if (o >= all.length) o = 0                              // loop, like a band that keeps streaming
      }, 50)
      return () => clearInterval(id)
    }

    // ---- Bluetooth (Nordic UART TX notifications)
    const dev = new EventTarget() as EventTarget & Record<string, unknown>
    const ch = new EventTarget() as EventTarget & Record<string, unknown>
    let stopPlay: (() => void) | null = null
    ch.startNotifications = async () => {
      stopPlay = player((c) => { ch.value = new DataView(c.buffer); ch.dispatchEvent(new Event('characteristicvaluechanged')) })
      return ch
    }
    ch.stopNotifications = async () => { stopPlay?.(); stopPlay = null }
    const gatt = {
      connected: false,
      connect: async () => { gatt.connected = true; return { getPrimaryService: async () => ({ getCharacteristic: async () => ch }) } },
      disconnect: () => { gatt.connected = false; stopPlay?.() },
    }
    dev.name = 'MESP-Health'
    dev.gatt = gatt
    band.bleDrop = () => { gatt.connected = false; stopPlay?.(); stopPlay = null; dev.dispatchEvent(new Event('gattserverdisconnected')) }
    Object.defineProperty(navigator, 'bluetooth', { value: { requestDevice: async () => dev } })

    // ---- USB cable (Web Serial, Seeed XIAO nRF52840)
    const port: Record<string, unknown> = {
      getInfo: () => ({ usbVendorId: 0x2886, usbProductId: 0x8045 }),
      open: async () => {
        let stop: (() => void) | null = null
        port.readable = new ReadableStream<Uint8Array>({
          start(ctrl) {
            stop = player((c) => ctrl.enqueue(c))
            band.usbPull = () => { stop?.(); ctrl.error(new Error('device lost')) }
          },
          cancel() { stop?.() },
        })
      },
      close: async () => undefined,
    }
    Object.defineProperty(navigator, 'serial', { value: { requestPort: async () => port } })
  }, streamB64)
}

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(EMAIL!)
  await page.getByLabel('Password').fill(PASSWORD!)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/app/**')
  await page.goto('/app/live')
  const add = page.getByRole('button', { name: 'Add my wristband' })
  const panel = page.getByRole('heading', { name: 'Connect your wristband' })
  await expect(add.or(panel)).toBeVisible({ timeout: 15_000 })      // fresh account: add the band first
  if (await add.isVisible()) await add.click()
  await expect(panel).toBeVisible({ timeout: 15_000 })
}

async function liveVitals(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: 'LIVE' })).toBeVisible({ timeout: 20_000 })
  // heart rate from the ECG becomes a real number once enough beats have arrived
  await expect(page.locator('section[aria-label="Vital signs"] > *').first()).not.toContainText('—', { timeout: 30_000 })
  await expect(page.getByText('SIMULATED DATA')).toHaveCount(0)    // real path: not labelled synthetic
}

test.describe.configure({ mode: 'serial' })

test('Bluetooth: connect, live data, wristband alerts, drop + auto-reconnect, disconnect', async ({ page }) => {
  await fakeBand(page)
  await login(page)
  await page.getByRole('button', { name: /Connect by Bluetooth/ }).click()
  await expect(page.getByText('Connected by Bluetooth (MESP-Health)')).toBeVisible({ timeout: 15_000 })
  await liveVitals(page)
  await expect(page.getByText('Damaged packets').locator('..')).toContainText('0')
  await page.screenshot({ path: test.info().outputPath('ble-live.png'), fullPage: true })

  // the band drops out of range: page says so and reconnects on its own
  await page.evaluate(() => (window as unknown as { __band: { bleDrop: () => void } }).__band.bleDrop())
  await expect(page.getByText(/Trying to reconnect/)).toBeVisible()
  await expect(page.getByRole('status').getByText('Reconnected', { exact: true })).toBeVisible({ timeout: 15_000 })

  // alerts raised by the band's own fall + AFib detectors reach the Events page
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Events' }).click()   // in-app: keeps the link
  await expect(page.getByText('Fall detected by the wristband').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Irregular rhythm (AFib pattern) flagged by the wristband').first()).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('ble-events.png'), fullPage: true })

  // connection survives page changes; Disconnect stops it
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Live' }).click()
  await expect(page.getByText('Connected by Bluetooth (MESP-Health)')).toBeVisible()
  const disconnectAlarms = () => page.evaluate(async () => {
    const { token } = JSON.parse(sessionStorage.getItem('mesp.session')!)
    const r = await fetch('/api/v1/events?limit=200', { headers: { Authorization: `Bearer ${token}` } })
    return ((await r.json()).items as { code: string }[]).filter((e) => e.code === 'device_disconnected').length
  })
  const before = await disconnectAlarms()
  await page.getByRole('button', { name: 'Disconnect' }).click()
  await expect(page.getByRole('button', { name: /Connect by USB cable/ })).toBeVisible()
  await page.waitForTimeout(1500)
  expect(await disconnectAlarms()).toBe(before)   // pressing Disconnect is not an alarm
})

test('USB cable: connect, live data, cable pulled is reported', async ({ page }) => {
  await fakeBand(page)
  await login(page)
  await page.getByRole('button', { name: /Connect by USB cable/ }).click()
  await expect(page.getByText(/Connected by USB cable \(USB 2886:8045\)/)).toBeVisible({ timeout: 15_000 })
  await liveVitals(page)
  await page.screenshot({ path: test.info().outputPath('usb-live.png'), fullPage: true })
  await page.evaluate(() => (window as unknown as { __band: { usbPull: () => void } }).__band.usbPull())
  await expect(page.getByRole('alert').filter({ hasText: 'Plug it back in' })).toBeVisible({ timeout: 10_000 })
})
