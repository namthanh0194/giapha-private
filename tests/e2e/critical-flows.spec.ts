import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import {
  ensureBucket,
  ensureTestUser,
  getTestAdminSupabase,
  seedPaginationPersons
} from './helpers'

const runId = randomUUID()
const runLabel = `E2E ${runId}`
const ADMIN = {
  email: `e2e-admin-${runId}@example.test`,
  password: 'E2E-admin-password-2026'
}
const INACTIVE_MEMBER = {
  email: `e2e-inactive-${runId}@example.test`,
  password: 'E2E-inactive-password-2026'
}
const MEMBER = {
  email: `e2e-member-${runId}@example.test`,
  password: 'E2E-member-password-2026'
}
const CREATED_USER_EMAIL = `e2e-created-editor-${runId}@example.test`
const PAGINATION_QUERY = `${runLabel} Person`
const FIRST_PAGINATION_PERSON = `${PAGINATION_QUERY} 0001`
const PARENT_NAME = `${runLabel} relationship parent`
const CHILD_NAME = `${runLabel} relationship child`
const RESTORE_MARKER = `${runLabel} restore marker`
const GALLERY_TITLE = `${runLabel} gallery image`

const createdUserIds = new Set<string>()
const createdPersonIds = new Set<string>()
const createdRelationshipIds = new Set<string>()
const createdGalleryItemIds = new Set<string>()
const createdStoragePaths = new Set<string>()

let parentId = ''
let childId = ''

async function login(page: Page, credentials: { email: string; password: string }) {
  await page.goto('/login')
  await page.getByPlaceholder('name@example.com').fill(credentials.email)
  await page.getByPlaceholder('Nhập mật khẩu').fill(credentials.password)
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
  await page.waitForURL('**/dashboard', { timeout: 15000 })
}

async function createPerson(name: string, gender: 'male' | 'female', generation: number) {
  const supabase = getTestAdminSupabase()
  const { data, error } = await supabase
    .from('persons')
    .insert({
      full_name: name,
      gender,
      birth_year: 1970,
      generation,
      birth_order: 1
    })
    .select('id')
    .single()

  if (error || !data) throw new Error(`Failed to create ${name}: ${error?.message}`)
  createdPersonIds.add(data.id)
  return data.id
}

async function deleteExactRows(table: string, ids: Set<string>) {
  const supabase = getTestAdminSupabase()
  for (const id of ids) {
    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) throw new Error(`Failed to delete ${table} row ${id}: ${error.message}`)
  }
}

test.describe.serial('Phase 2 critical flows', () => {
  test.beforeAll(async () => {
    await ensureBucket('gallery')

    for (const user of [
      await ensureTestUser({ ...ADMIN, role: 'admin', isActive: true }),
      await ensureTestUser({ ...INACTIVE_MEMBER, role: 'member', isActive: false }),
      await ensureTestUser({ ...MEMBER, role: 'member', isActive: true })
    ]) {
      createdUserIds.add(user.id)
    }

    const paginationPersonIds = await seedPaginationPersons(runId, 1001)
    paginationPersonIds.forEach((id) => createdPersonIds.add(id))
    parentId = await createPerson(PARENT_NAME, 'male', 1)
    childId = await createPerson(CHILD_NAME, 'female', 2)
  })

  test.afterAll(async () => {
    const supabase = getTestAdminSupabase()

    await deleteExactRows('relationships', createdRelationshipIds)
    await deleteExactRows('gallery_items', createdGalleryItemIds)

    for (const storagePath of createdStoragePaths) {
      const { error } = await supabase.storage.from('gallery').remove([storagePath])
      if (error) throw new Error(`Failed to delete gallery object ${storagePath}: ${error.message}`)
    }

    await deleteExactRows('persons', createdPersonIds)

    for (const userId of createdUserIds) {
      const { error } = await supabase.auth.admin.deleteUser(userId)
      if (error) throw new Error(`Failed to delete auth user ${userId}: ${error.message}`)
    }
  })

  test('health and readiness report the local application state', async ({ request }) => {
    const health = await request.get('/api/health')
    expect(health.status()).toBe(200)
    expect(health.headers()['cache-control']).toContain('no-store')
    expect(await health.json()).toEqual({ status: 'ok', version: '1.0.0' })

    const readiness = await request.get('/api/readiness')
    expect(readiness.status()).toBe(200)
    expect(readiness.headers()['cache-control']).toContain('no-store')
    expect(await readiness.json()).toEqual({ status: 'ready', database: 'connected' })
  })

  test('inactive users see the approval screen and members remain read-only', async ({ page }) => {
    await login(page, INACTIVE_MEMBER)
    await expect(page.getByRole('heading', { name: 'Tài khoản chờ duyệt' })).toBeVisible()

    await page.getByRole('button', { name: /Đăng xuất/ }).click()
    await expect(page).toHaveURL(/\/login$/)

    await login(page, MEMBER)
    await page.goto(`/dashboard/members?query=${encodeURIComponent(PAGINATION_QUERY)}`)
    await expect(page.getByText(FIRST_PAGINATION_PERSON)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Thêm thành viên' })).toHaveCount(0)
    await page.goto('/dashboard/members/new')
    await expect(page.getByRole('heading', { name: 'Truy cập bị từ chối' })).toBeVisible()
  })

  test('admin can create users, page member lists, and create relationships', async ({ page }) => {
    await login(page, ADMIN)

    await page.goto('/dashboard/users')
    await page.getByRole('button', { name: 'Thêm người dùng' }).click()
    const dialog = page.getByRole('heading', { name: 'Tạo người dùng mới' }).locator('..').locator('..')
    await dialog.locator('input[name="email"]').fill(CREATED_USER_EMAIL)
    await dialog.locator('input[name="password"]').fill('E2E-created-password-2026')
    await dialog.locator('select[name="role"]').selectOption('editor')
    await dialog.getByRole('button', { name: 'Tạo người dùng', exact: true }).click()
    await expect(page.getByText('Tạo người dùng thành công! Họ có thể đăng nhập ngay bây giờ.')).toBeVisible()
    await expect.poll(async () => {
      const { data } = await getTestAdminSupabase().auth.admin.listUsers({ page: 1, perPage: 1000 })
      const createdUser = data.users.find((user) => user.email === CREATED_USER_EMAIL)
      if (createdUser) createdUserIds.add(createdUser.id)
      return Boolean(createdUser)
    }).toBe(true)

    await page.goto(`/dashboard/members?query=${encodeURIComponent(PAGINATION_QUERY)}`)
    await expect(page.getByText(/Trang 1 \/ 21/)).toBeVisible()
    await page.getByRole('button', { name: 'Trang sau' }).click()
    await expect(page).toHaveURL(/page=2/)
    await expect(page.getByText(/Trang 2 \/ 21/)).toBeVisible()

    await page.goto(`/dashboard/members/${parentId}`)
    await page.getByRole('button', { name: '+ Thêm Quan Hệ' }).click()
    await page.getByLabel('Loại quan hệ').selectOption('child')
    await page.getByLabel('Tìm người thân').fill(CHILD_NAME)
    await page.getByRole('button', { name: CHILD_NAME }).click()
    await page.getByRole('button', { name: 'Lưu', exact: true }).click()
    await expect.poll(async () => {
      const { data } = await getTestAdminSupabase()
        .from('relationships')
        .select('id')
        .eq('person_a', parentId)
        .eq('person_b', childId)
        .eq('type', 'biological_child')
        .maybeSingle()
      if (data) createdRelationshipIds.add(data.id)
      return Boolean(data)
    }).toBe(true)
  })

  test('admin uploads and deletes gallery media', async ({ page }) => {
    await login(page, ADMIN)

    await page.goto('/dashboard/gallery')
    await page.getByRole('button', { name: 'Thêm hình ảnh' }).click()
    await page.locator('input[type="file"]').setInputFiles({
      name: `${runId}.png`,
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+MNGH5wAAAABJRU5ErkJggg==',
        'base64'
      )
    })
    await page.getByPlaceholder('Ví dụ: Lễ mừng thọ ông nội').fill(GALLERY_TITLE)
    await page.getByRole('button', { name: 'Lưu hình ảnh' }).click()
    await expect(page.getByText(GALLERY_TITLE)).toBeVisible()

    const { data: galleryItem, error: galleryError } = await getTestAdminSupabase()
      .from('gallery_items')
      .select('id, image_url')
      .eq('title', GALLERY_TITLE)
      .single()
    if (galleryError || !galleryItem) {
      throw new Error(`Failed to track gallery fixture: ${galleryError?.message}`)
    }
    createdGalleryItemIds.add(galleryItem.id)
    createdStoragePaths.add(galleryItem.image_url)

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByText(GALLERY_TITLE).first().click()
    await page.getByRole('button', { name: 'Xóa', exact: true }).click()
    await expect(page.getByText(GALLERY_TITLE)).toHaveCount(0)
  })

  test('admin exports and restores a backup', async ({ page }) => {
    await login(page, ADMIN)

    await page.goto('/dashboard/data')
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Xuất JSON' }).click()
    const download = await downloadPromise
    const stream = await download.createReadStream()
    if (!stream) throw new Error('Export did not produce a readable download')
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk))

    const { data: marker, error: markerError } = await getTestAdminSupabase()
      .from('persons')
      .insert({
        full_name: RESTORE_MARKER,
        gender: 'other',
        birth_year: 2000,
        generation: 9,
        birth_order: 1
      })
      .select('id')
      .single()
    if (markerError || !marker) {
      throw new Error(`Failed to create restore marker: ${markerError?.message}`)
    }
    createdPersonIds.add(marker.id)

    await page.locator('input[type="file"]').setInputFiles({
      name: `${runId}-backup.json`,
      mimeType: 'application/json',
      buffer: Buffer.concat(chunks)
    })
    await page.getByRole('button', { name: 'Vẫn tiếp tục' }).click()
    await expect(page.getByText(/Phục hồi thành công!/)).toBeVisible()
    await expect.poll(async () => {
      const { count } = await getTestAdminSupabase()
        .from('persons')
        .select('*', { count: 'exact', head: true })
        .eq('id', marker.id)
      return count
    }).toBe(0)

    const { data: restoredRelationship, error: relationshipError } = await getTestAdminSupabase()
      .from('relationships')
      .select('id')
      .eq('person_a', parentId)
      .eq('person_b', childId)
      .eq('type', 'biological_child')
      .maybeSingle()
    if (relationshipError || !restoredRelationship) {
      throw new Error(`Failed to track restored relationship: ${relationshipError?.message}`)
    }
    createdRelationshipIds.add(restoredRelationship.id)
  })
})