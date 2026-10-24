import { expect, test } from '@playwright/test'

for (const path of ['/', '/login']) {
  test(`no horizontal overflow on ${path}`, async ({ page }) => {
    await page.goto(path)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })
}

test('mobile live dashboard: menu works and no overflow', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Explore the demo' }).click()
  await page.waitForURL('**/app/live')
  await page.waitForTimeout(2000)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Events' }).click()
  await expect(page).toHaveURL(/\/app\/events/)
})

test('mobile landing: hero fits the first screen and the menu reaches sections and sign in', async ({ page }) => {
  await page.goto('/')
  const h1 = await page.getByRole('heading', { level: 1 }).boundingBox()
  expect(h1!.y + h1!.height).toBeLessThan(page.viewportSize()!.height * 0.6)   // no empty gap above the headline
  await page.getByRole('button', { name: 'Open menu' }).click()
  const menu = page.getByRole('dialog', { name: 'Menu' })
  await expect(menu.getByRole('link', { name: 'Sign in' })).toBeVisible()
  await menu.getByRole('link', { name: 'Connection' }).click()
  await expect(menu).toBeHidden()
  await expect(page.locator('#connection')).toBeInViewport()
})

test('landing respects reduced motion', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await page.goto('/')
  await page.getByRole('button', { name: 'Open menu' }).click()
  await expect(page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'Play animations' })).toHaveAttribute('aria-pressed', 'true')
  await ctx.close()
})
