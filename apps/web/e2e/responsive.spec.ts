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
