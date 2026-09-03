# Migration legacy (deprecated)

`docs/schema.sql` và `docs/migrations/` chỉ được giữ lại trong một bản phát hành tương thích.

Nguồn migration chính thức duy nhất là `supabase/migrations/`. Mọi migration mới phải được thêm tại đó và đăng ký trong `utils/migrations/catalog.ts`.
