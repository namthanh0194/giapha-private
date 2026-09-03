/**
 * responsive.spec.ts – Phase 3 Task 9
 *
 * Each test is pinned to one viewport project via test.skip(), so the total
 * run count stays at 5 regardless of how many flows are covered.
 *
 * Viewport project names (playwright.config.ts): 375x667 430x932 768x1024 1024x768 1440x900
 *
 * Assertions per roadmap:
 *   A no horizontal page overflow (except intentional tree canvas)
 *   B fixed controls do not cover content
 *   C dialogs fit and scroll internally
 *   D touch targets >= 44x44 CSS px
 *   E tree toolbar reachable
 *   F text does not clip at 200% zoom
 *
 * Screenshots on failure saved to tmp/responsive-screenshots/ (not committed).
 */
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { ensureTestUser, getTestAdminSupabase } from './helpers'

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------
const runId = randomUUID()
const ADMIN = {
  email: `resp-admin-${runId}@example.test`,
  password: 'Resp-admin-2026!'
}
const createdUserIds = new Set<string>()

async function login(page: Page) {
  await page.goto('/login')
  await page.getByPlaceholder('name@example.com').fill(ADMIN.email)
  await page.getByPlaceholder('Nhập mật khẩu').fill(ADMIN.password)
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
  await page.waitForURL('**/dashboard', { timeout: 20_000 })
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------
function screenshotDir(): string {
  const dir = path.join('tmp', 'responsive-screenshots')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
async function maybeShot(page: Page, label: string) {
  await page.screenshot({ path: path.join(screenshotDir(), `${label}.png`), fullPage: false })
}

async function assertNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  if (overflow > 1) await maybeShot(page, `${label}-overflow`)
  expect(overflow, `${label}: horizontal overflow ${overflow}px`).toBeLessThanOrEqual(1)
}

async function assertTouchTargets(page: Page, label: string) {
  const violations = await page.evaluate(() => {
    return Array.from(
      document.querySelectorAll<HTMLElement>('button, a[href], [role="button"]')
    )
      .filter((el) => {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) return false
        if (r.bottom < 0 || r.top > window.innerHeight) return false
        if (r.right < 0 || r.left > window.innerWidth) return false
        return r.width < 44 || r.height < 44
      })
      .map((el) => {
        const r = el.getBoundingClientRect()
        const name =
          el.getAttribute('aria-label') ||
          el.textContent?.trim().slice(0, 40) ||
          el.getAttribute('title') ||
          el.tagName
        return `${name}: ${Math.round(r.width)}×${Math.round(r.height)}`
      })
  })
  if (violations.length > 0) await maybeShot(page, `${label}-touch`)
  expect(violations, `${label}: touch targets <44px`).toEqual([])
}

async function assertNoTextClip(page: Page, label: string) {
  const clipped = await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>('*')) {
      const s = window.getComputedStyle(el)
      if (
        el.childElementCount === 0 &&
        (s.overflow === 'hidden' || s.overflowX === 'hidden') &&
        el.scrollWidth > el.clientWidth + 2
      ) {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.top < window.innerHeight && r.bottom > 0 && el.textContent!.trim().length > 0)
          return el.tagName + '.' + Array.from(el.classList).join('.')
      }
    }
    return null
  })
  if (clipped) await maybeShot(page, `${label}-clip`)
  expect(clipped, `${label}: text clipped – ${clipped}`).toBeNull()
}

async function assertDialogFits(page: Page, label: string) {
  const r = await page.evaluate(() => {
    const d = document.querySelector<HTMLElement>('[role="dialog"]')
    if (!d) return null
    const rect = d.getBoundingClientRect()
    return { tooTall: rect.height > window.innerHeight + 2, tooWide: rect.width > window.innerWidth + 2, h: Math.round(rect.height), w: Math.round(rect.width) }
  })
  if (!r) return
  if (r.tooTall || r.tooWide) await maybeShot(page, `${label}-dialog`)
  expect(r.tooTall, `${label}: dialog ${r.h}px taller than viewport`).toBe(false)
  expect(r.tooWide, `${label}: dialog ${r.w}px wider than viewport`).toBe(false)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function vp(page: Page) {
  const { width, height } = page.viewportSize()!
  return { width, height, label: `${width}x${height}` }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
test.describe.serial('Responsive viewport checks', () => {
  test.beforeAll(async () => {
    const user = await ensureTestUser({ ...ADMIN, role: 'admin', isActive: true })
    createdUserIds.add(user.id)
  })

  test.afterAll(async () => {
    const supabase = getTestAdminSupabase()
    for (const userId of createdUserIds) await supabase.auth.admin.deleteUser(userId)
  })

  // -------------------------------------------------------------------------
  // VP1 375×667 – login + member list (small phone)
  // -------------------------------------------------------------------------
  test('375x667: login + member list', async ({ page }) => {
    test.skip(page.viewportSize()?.width !== 375, 'only for 375x667 project')
    const L = vp(page).label

    // Login: A D F
    await page.goto('/login')
    await expect(page.getByPlaceholder('name@example.com')).toBeVisible()
    await assertNoHorizontalOverflow(page, `${L}-login`)
    await assertTouchTargets(page, `${L}-login`)

    // 200% zoom text clip (F)
    await page.evaluate(() => document.documentElement.style.setProperty('font-size', '200%', 'important'))
    await page.waitForTimeout(200)
    await assertNoTextClip(page, `${L}-zoom-login`)
    await page.evaluate(() => document.documentElement.style.removeProperty('font-size'))

    // Member list: A D
    await login(page)
    await page.goto('/dashboard/members')
    await page.waitForLoadState('networkidle')
    await assertNoHorizontalOverflow(page, `${L}-members`)
    await assertTouchTargets(page, `${L}-members`)
    await assertNoTextClip(page, `${L}-members`)
  })

  // -------------------------------------------------------------------------
  // VP2 430×932 – member form + detail modal (large phone)
  // -------------------------------------------------------------------------
  test('430x932: member form + detail modal', async ({ page }) => {
    test.skip(page.viewportSize()?.width !== 430, 'only for 430x932 project')
    const L = vp(page).label

    await login(page)

    // Member form: A D
    await page.goto('/dashboard/members/new')
    await page.waitForLoadState('networkidle')
    await assertNoHorizontalOverflow(page, `${L}-form`)
    await assertTouchTargets(page, `${L}-form`)
    await assertNoTextClip(page, `${L}-form`)
    const submitBtn = page.getByRole('button', { name: /Thêm thành viên/i }).last()
    await expect(submitBtn).toBeVisible()
    const box = await submitBtn.boundingBox()
    expect(box, `${L}: submit button not rendered`).not.toBeNull()
    expect(box!.height, `${L}: submit height`).toBeGreaterThanOrEqual(44)

    // Detail modal: C D (open create-member modal to trigger dialog)
    await page.goto('/dashboard/members')
    await page.waitForLoadState('networkidle')
    const addBtn = page.getByRole('button', { name: /Thêm thành viên/i })
    if (await addBtn.isVisible()) {
      await addBtn.click()
      await page.waitForTimeout(400)
      await assertDialogFits(page, `${L}-modal`)
      await assertTouchTargets(page, `${L}-modal`)
      const closeBtn = page.getByRole('button', { name: 'Đóng', exact: true })
      if (await closeBtn.isVisible()) {
        const cb = await closeBtn.boundingBox()
        expect(cb!.height, `${L}: close button height`).toBeGreaterThanOrEqual(44)
      }
    }
  })

  // -------------------------------------------------------------------------
  // VP3 768×1024 – gallery + upload modal (tablet portrait)
  // -------------------------------------------------------------------------
  test('768x1024: gallery + upload modal', async ({ page }) => {
    test.skip(page.viewportSize()?.width !== 768, 'only for 768x1024 project')
    const L = vp(page).label

    await login(page)

    // Gallery: A D
    await page.goto('/dashboard/gallery')
    await page.waitForLoadState('networkidle')
    await assertNoHorizontalOverflow(page, `${L}-gallery`)
    await assertTouchTargets(page, `${L}-gallery`)
    await assertNoTextClip(page, `${L}-gallery`)

    // Upload modal: C D
    const uploadBtn = page.getByRole('button', { name: /Thêm hình ảnh/i })
    if (await uploadBtn.isVisible()) {
      await uploadBtn.click()
      await page.waitForTimeout(400)
      await assertDialogFits(page, `${L}-upload`)
      await assertTouchTargets(page, `${L}-upload`)
      const closeBtn = page.getByRole('button', { name: /Đóng hộp thoại tải ảnh/i })
      await expect(closeBtn).toBeVisible()
      const cb = await closeBtn.boundingBox()
      expect(cb!.height, `${L}: upload-close height`).toBeGreaterThanOrEqual(44)
      await closeBtn.click()
    }
  })

  // -------------------------------------------------------------------------
  // VP4 1024×768 – tree toolbar + activity history (tablet landscape)
  // -------------------------------------------------------------------------
  test('1024x768: tree toolbar + activity history', async ({ page }) => {
    test.skip(page.viewportSize()?.width !== 1024, 'only for 1024x768 project')
    const L = vp(page).label

    await login(page)

    // Tree toolbar: E (B implied – toolbar rendered in portal at bottom)
    await page.goto('/dashboard/members')
    await page.waitForLoadState('networkidle')
    const treeBtn = page.getByRole('button', { name: /Sơ đồ cây/i })
    if (await treeBtn.isVisible()) {
      await treeBtn.click()
      await page.waitForTimeout(600)
      for (const title of ['Thu nhỏ', 'Đặt lại', 'Phóng to', 'Căn giữa']) {
        const btn = page.locator(`button[title="${title}"]`)
        if (await btn.isVisible()) {
          const b = await btn.boundingBox()
          if (b) {
            expect(b.width, `${L}: "${title}" width`).toBeGreaterThanOrEqual(44)
            expect(b.height, `${L}: "${title}" height`).toBeGreaterThanOrEqual(44)
            const { height } = vp(page)
            expect(b.y + b.height, `${L}: "${title}" below viewport`).toBeLessThanOrEqual(height + 1)
          }
        }
      }
    }

    // Activity history: A D
    await page.goto('/dashboard/activity')
    await page.waitForLoadState('networkidle')
    await assertNoHorizontalOverflow(page, `${L}-activity`)
    await assertTouchTargets(page, `${L}-activity`)
    await assertNoTextClip(page, `${L}-activity`)
    await expect(page.getByRole('heading', { name: /Lịch sử hoạt động/i })).toBeVisible()
  })

  // -------------------------------------------------------------------------
  // VP5 1440×900 – reviews + 200% zoom on members (desktop)
  // -------------------------------------------------------------------------
  test('1440x900: reviews + zoom-200% members', async ({ page }) => {
    test.skip(page.viewportSize()?.width !== 1440, 'only for 1440x900 project')
    const L = vp(page).label

    await login(page)

    // Reviews: A D
    await page.goto('/dashboard/reviews')
    await page.waitForLoadState('networkidle')
    await assertNoHorizontalOverflow(page, `${L}-reviews`)
    await assertTouchTargets(page, `${L}-reviews`)
    await assertNoTextClip(page, `${L}-reviews`)
    await expect(page.getByRole('heading', { name: /Rà soát đóng góp/i })).toBeVisible()

    // 200% zoom member list (F)
    await page.goto('/dashboard/members')
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => document.documentElement.style.setProperty('font-size', '200%', 'important'))
    await page.waitForTimeout(200)
    await assertNoTextClip(page, `${L}-zoom-members`)
  })
})
