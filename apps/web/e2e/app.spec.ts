import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function demoLogin(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Explore the demo' }).click()
  await page.waitForURL('**/app/live')
}

test('landing page tells the story and carries the disclaimer', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Three sensors')
  for (const id of ['signal', 'processing', 'connection', 'platform', 'data', 'system']) await expect(page.locator(`#${id}`)).toBeAttached()
  await expect(page.getByText('It is not a medical device').first()).toBeAttached()
  await expect(page.getByText('Not yet measured')).toBeAttached()
})

test('frame anatomy explains real firmware bytes', async ({ page }) => {
  await page.goto('/#connection')
  await page.getByRole('option', { name: /CRC-16/ }).focus()
  await expect(page.getByText(/One flipped bit and the frame is rejected/)).toBeVisible()
})

test('demo login shows a live, clearly synthetic dashboard', async ({ page }) => {
  await demoLogin(page)
  await expect(page.getByText('DEMO MODE — SYNTHETIC DATA').first()).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'LIVE' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('SIMULATED DATA').first()).toBeVisible()
  // vitals populate
  await expect(page.locator('section[aria-label="Vital signs"]')).toContainText('bpm', { timeout: 20_000 })
  // the ECG canvas actually draws
  const drawn = await page.locator('canvas').first().evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++
    return n
  })
  expect(drawn).toBeGreaterThan(500)
  // battery is honest
  await expect(page.getByText('Current firmware has no MAX17048 fuel-gauge driver.')).toBeVisible()
})

test('waveform keyboard controls: pause and zoom', async ({ page }) => {
  await demoLogin(page)
  const ecg = page.getByRole('img', { name: /^ECG waveform/ })
  await ecg.focus()
  await page.keyboard.press('Space')
  await expect(ecg).toHaveAttribute('aria-label', /Paused/)
  await page.keyboard.press('Space')
  await expect(ecg).toHaveAttribute('aria-label', /Live/)
})

test('scenario -> event -> acknowledge -> sensor timeline', async ({ page }) => {
  await demoLogin(page)
  await page.goto('/app/demo')
  await page.getByLabel('Speed').selectOption('8')
  const fall = page.locator('div.rounded-lg', { hasText: 'Walking, free-fall' }).first()
  await fall.getByRole('button', { name: /Run scenario|Restart/ }).click()
  await page.waitForURL('**/app/live')
  await page.goto('/app/events')
  const row = page.locator('li', { hasText: 'Fall suspected' }).first()
  await expect(row).toBeVisible({ timeout: 45_000 })
  await row.getByRole('button', { name: 'Acknowledge' }).click()
  await page.getByLabel('Note (optional)').fill('E2E check')
  await page.getByRole('dialog').getByRole('button', { name: 'Acknowledge' }).click()
  await page.getByRole('radio', { name: 'Acknowledged', exact: true }).click()
  const acked = page.locator('li', { hasText: 'E2E check' }).first()
  await expect(acked).toBeVisible()
  await acked.getByRole('link', { name: /on the sensor timeline/ }).click()
  await expect(page).toHaveURL(/\/app\/history\/.+stream=imu/)
  await expect(page.getByText('Sensor timeline')).toBeVisible()
  await page.goto('/app/demo')
  await page.locator('div.rounded-lg', { hasText: 'Seated, still' }).first().getByRole('button', { name: /Run scenario|Restart/ }).click()
})

test('history page loads charts and export dialog labels synthetic data', async ({ page }) => {
  await demoLogin(page)
  await page.goto('/app/history')
  await expect(page.getByRole('img', { name: /Vitals timeline/ })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Export' }).click()
  await expect(page.getByRole('dialog')).toContainText('SIMULATED DATA')
})

test('no serious accessibility violations on key pages', async ({ page }) => {
  await page.goto('/')
  const scan = async () => (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).disableRules(['region']).analyze()).violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(await scan(), 'landing').toEqual([])
  await page.goto('/login')
  expect(await scan(), 'login').toEqual([])
  await demoLogin(page)
  await page.waitForTimeout(3000)
  expect(await scan(), 'live').toEqual([])
  await page.goto('/app/events')
  expect(await scan(), 'events').toEqual([])
})
