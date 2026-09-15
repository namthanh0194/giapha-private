# AGENTS.md

## UI

For any UI work, follow @DESIGN.md strictly. Don't invent new tokens.

## Production Database Migrations

- **KHÔNG BAO GIỜ** chạy trực tiếp các lệnh migration, thay đổi cấu trúc DB, RPC hoặc xóa/sửa dữ liệu trên Production Database bằng `supabase db push`, `psql`, Supabase CLI hoặc SQL Editor nếu không có yêu cầu đặc biệt.
- Mọi thay đổi database (schema, trigger, RPC, policies) cho Production **BẮT BUỘC** phải được tạo thành một migration mới có timestamp trong thư mục `supabase/migrations/` và đăng ký vào `MIGRATION_CATALOG` cùng `readMigrationContent` trong `utils/migrations/catalog.ts`.
- Toàn bộ việc cập nhật database Production phải được quản trị viên thực thi thông qua tính năng nâng cấp hệ thống: **"Chạy migration"** trên giao diện UI tại `/dashboard/upgrade`.
- Tuyệt đối không sửa nội dung tệp migration cũ đã từng được chạy. Phải luôn tạo migration mới để đảm bảo tính toàn vẹn (idempotent/append-only).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
