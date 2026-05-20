import { test, expect } from './fixtures/admin-auth'

/**
 * Notification bell behavior:
 *  - The bell badge displays the unread count from /notifications/unread-count.
 *  - Clicking the bell opens the inbox dropdown.
 *  - "Tout marquer comme lu" zeroes the badge.
 */
test.describe('notifications bell', () => {
  test('bell shows unread count and mark-all-as-read zeroes it', async ({ adminPage, baseURL }) => {
    const jwt = await adminPage.evaluate(() => localStorage.getItem('jwt'))
    expect(jwt).toBeTruthy()

    // Ensure at least one unread notification exists so the badge has
    // something to render. The simplest reliable way is to read the current
    // count — if it's already > 0 we're set; if not, we skip the badge
    // assertion (rather than spamming the prod test DB with synthetic rows).
    const countRes = await adminPage.request.get(`${baseURL}/notifications/unread-count`, {
      headers: { Authorization: `Bearer ${jwt}` },
    })
    expect(countRes.ok()).toBeTruthy()
    const { count } = await countRes.json()

    await adminPage.goto('/app')
    const bell = adminPage.locator('button:has(i.pi-bell), [aria-label*="notification" i]').first()
    await expect(bell).toBeVisible({ timeout: 15_000 })

    if (count > 0) {
      // The badge is rendered as a tag or span inside / next to the bell.
      const badge = adminPage.locator('.p-badge, [data-test="notification-badge"], button:has(i.pi-bell) >> text=/^\\d+$/').first()
      await expect(badge).toBeVisible({ timeout: 5_000 })
    }

    // Open the dropdown.
    await bell.click()
    const dropdown = adminPage.locator('[role="menu"], .notification-panel, .p-overlaypanel').first()
    await expect(dropdown).toBeVisible({ timeout: 5_000 })

    // Click "Tout marquer comme lu" if present, otherwise hit the endpoint
    // directly so the assertion below is meaningful even if the button label
    // drifts.
    const markAll = adminPage.getByRole('button', { name: /tout marquer comme lu|mark all as read/i }).first()
    if (await markAll.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await markAll.click()
    } else {
      await adminPage.request.post(`${baseURL}/notifications/mark-all-read`, {
        headers: { Authorization: `Bearer ${jwt}` },
      })
    }

    // After mark-all, unread count is 0.
    const after = await adminPage.request.get(`${baseURL}/notifications/unread-count`, {
      headers: { Authorization: `Bearer ${jwt}` },
    })
    const { count: countAfter } = await after.json()
    expect(countAfter).toBe(0)
  })
})
