# Phase 1 hardening — 2 tháng 9 năm 2026

## Phạm vi

- Restore backup chạy nguyên tử trong PostgreSQL; lỗi validation không xóa dữ liệu hiện có.
- `custom_events` cho phép admin/editor ghi và member chỉ đọc.
- Database chặn relationship đảo chiều trùng, parent cycle, quá hai cha/mẹ sinh học và hôn nhân với tổ tiên/hậu duệ.
- Tạo spouse/children chạy qua RPC nguyên tử, không để lại person mồ côi khi relationship lỗi.
- Giá trị person, private detail, relationship, event và gallery được giới hạn bằng database constraints.
- `supabase/migrations/` là nguồn migration duy nhất; `/setup` và Dashboard upgrade dùng chung catalog.
- CSP được bật ở chế độ `Content-Security-Policy-Report-Only`.

## Thứ tự triển khai

1. Sao lưu database production và xác minh file backup có thể đọc được.
2. Deploy source chứa `utils/migrations/catalog.ts` cùng toàn bộ file trong `supabase/migrations/`.
3. Áp dụng migration theo thứ tự catalog bằng Supabase CLI hoặc Dashboard upgrade.
4. Chạy `supabase test db` trên staging.
5. Thực hiện restore drill trên staging bằng dữ liệu giả lập.
6. Deploy production.
7. Xác minh response headers, role matrix và các luồng tạo quan hệ.

## Backup và rollback

- Trước deployment, tạo database backup/snapshot theo cơ chế của Supabase project.
- Migration Phase 1 chủ yếu thêm function, policy, trigger, index và constraint. Không tự động sửa hoặc xóa dữ liệu cũ; migration dừng nếu phát hiện dữ liệu vi phạm.
- Nếu migration thất bại, giữ source production hiện tại và xử lý các row vi phạm trên staging trước khi chạy lại.
- Nếu cần rollback sau deployment, phục hồi database snapshot và redeploy source trước Phase 1. Không xóa thủ công constraint/function trên production khi chưa có migration rollback được review.

## Verification

Chạy tại repository root:

```powershell
& 'C:\Users\OS\.proto\bin\bun.exe' x supabase db reset
& 'C:\Users\OS\.proto\bin\bun.exe' x supabase test db
node --test tests/*.test.mjs
node node_modules/eslint/bin/eslint.js .
node node_modules/typescript/bin/tsc --noEmit
node node_modules/next/dist/bin/next build
git diff --check
```

Kết quả ngày 2 tháng 9 năm 2026: database tests, Node tests, ESLint, TypeScript, production build và diff check đều đạt.

## Restore drill

`supabase/tests/database/restore_backup.test.sql` xác minh bằng dữ liệu giả lập:

1. Restore persons, relationships, private details và custom events với counts chính xác.
2. Marker record tạo sau backup bị xóa khi restore.
3. `custom_events.created_by` được gán cho admin gọi RPC.
4. Invalid restore bị từ chối và dữ liệu trước đó giữ nguyên.

Kết quả ngày 2 tháng 9 năm 2026: `9/9` assertion đạt.

## Release gate

- [x] Restore nguyên tử.
- [x] Custom events được restore đầy đủ.
- [x] Member chỉ đọc custom events.
- [x] Relationship invariants được database enforce.
- [x] Tạo spouse/children nguyên tử.
- [x] Mọi installation path dùng một migration catalog.
- [x] CSP report-only có mặt.
- [x] Verification matrix đạt.
