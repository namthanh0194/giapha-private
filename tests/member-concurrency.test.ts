import { beforeEach, describe, expect, test, vi } from "vitest"

const { getProfile, getSupabase, revalidatePath, toPublicError } = vi.hoisted(
  () => ({
    getProfile: vi.fn(),
    getSupabase: vi.fn(),
    revalidatePath: vi.fn(),
    toPublicError: vi.fn((_error: unknown, message: string) => ({
      id: "error-id",
      message
    }))
  })
)

vi.mock("@/utils/supabase/queries", () => ({ getProfile, getSupabase }))
vi.mock("next/cache", () => ({ revalidatePath }))
vi.mock("@/utils/errors", () => ({ toPublicError }))

import { updateMemberAction } from "@/app/actions/member"

const PERSON_ID = "41000000-0000-4000-8000-000000000001"

beforeEach(() => {
  vi.clearAllMocks()
  getProfile.mockResolvedValue({ role: "editor", is_active: true })
})

describe("updateMemberAction", () => {
  test("sends the expected version and returns the next version", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 4, error: null })
    getSupabase.mockResolvedValue({ rpc })

    await expect(
      updateMemberAction(PERSON_ID, 3, { full_name: "Nguyễn Văn A" })
    ).resolves.toEqual({ success: true, version: 4 })

    expect(rpc).toHaveBeenCalledWith("update_versioned_record", {
      target_table: "persons",
      target_id: PERSON_ID,
      expected_version: 3,
      changes: { full_name: "Nguyễn Văn A" }
    })
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/members/" + PERSON_ID)
  })

  test("returns a concurrency conflict without revalidating", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "40001", message: "Concurrency conflict." }
    })
    getSupabase.mockResolvedValue({ rpc })

    await expect(
      updateMemberAction(PERSON_ID, 3, { full_name: "Bản ghi cũ" })
    ).resolves.toEqual({
      success: false,
      conflict: true,
      error: "Dữ liệu đã được người khác cập nhật."
    })

    expect(revalidatePath).not.toHaveBeenCalled()
  })

  test("prevents silent overwrite on custom event updates using update_versioned_record", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "40001", message: "Concurrency conflict." }
    })
    getSupabase.mockResolvedValue({ rpc })

    const { updateCustomEventAction } = await import("@/app/actions/member")
    const result = await updateCustomEventAction("22222222-2222-4222-8222-222222222222", 1, {
      name: "Sự kiện sửa lại"
    })

    expect(result).toEqual({
      success: false,
      conflict: true,
      error: "Dữ liệu đã được người khác cập nhật."
    })
    expect(rpc).toHaveBeenCalledWith("update_versioned_record", {
      target_table: "custom_events",
      target_id: "22222222-2222-4222-8222-222222222222",
      expected_version: 1,
      changes: { name: "Sự kiện sửa lại" }
    })
  })

  test("prevents stale delete on custom events using delete_versioned_record", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "40001", message: "Concurrency conflict." }
    })
    getSupabase.mockResolvedValue({ rpc })

    const { deleteCustomEventAction } = await import("@/app/actions/member")
    const result = await deleteCustomEventAction("22222222-2222-4222-8222-222222222222", 1)

    expect(result).toEqual({
      success: false,
      conflict: true,
      error: "Dữ liệu đã được người khác cập nhật."
    })
    expect(rpc).toHaveBeenCalledWith("delete_versioned_record", {
      target_table: "custom_events",
      target_id: "22222222-2222-4222-8222-222222222222",
      expected_version: 1
    })
  })

  test("prevents stale delete on relationships using delete_versioned_record", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "40001", message: "Concurrency conflict." }
    })
    getSupabase.mockResolvedValue({ rpc })

    const { deleteRelationshipAction } = await import("@/app/actions/member")
    const result = await deleteRelationshipAction("44444444-4444-4444-8444-444444444444", 1)

    expect(result).toEqual({
      success: false,
      conflict: true,
      error: "Dữ liệu đã được người khác cập nhật."
    })
    expect(rpc).toHaveBeenCalledWith("delete_versioned_record", {
      target_table: "relationships",
      target_id: "44444444-4444-4444-8444-444444444444",
      expected_version: 1
    })
  })
})
