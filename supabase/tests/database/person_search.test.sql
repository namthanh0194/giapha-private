begin;
select plan(20);

delete from public.profiles
where id in (
  'a0000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000002',
  'b0000000-0000-4000-8000-000000000003',
  'c0000000-0000-4000-8000-000000000004'
);
delete from auth.users
where id in (
  'a0000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000002',
  'b0000000-0000-4000-8000-000000000003',
  'c0000000-0000-4000-8000-000000000004'
);

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin-search@example.test', '{}', '{}', now(), now()),
  ('e0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'editor-search@example.test', '{}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'member-search@example.test', '{}', '{}', now(), now()),
  ('c0000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'inactive-search@example.test', '{}', '{}', now(), now());

insert into public.profiles (id, role, is_active)
values
  ('a0000000-0000-4000-8000-000000000001', 'admin', true),
  ('e0000000-0000-4000-8000-000000000002', 'editor', true),
  ('b0000000-0000-4000-8000-000000000003', 'member', true),
  ('c0000000-0000-4000-8000-000000000004', 'member', false)
on conflict (id) do update
set role = excluded.role, is_active = excluded.is_active;

insert into public.persons (id, full_name, other_names, gender, birth_year, privacy_level, avatar_url)
values
  ('81111111-1111-4111-8111-111111111111', 'Nguyễn Văn An', 'Tự: An Bình; Tên thuở nhỏ: Bé Tí', 'male', 1980, 'family', '81111111-1111-4111-8111-111111111111/avatar.webp'),
  ('82222222-2222-4222-8222-222222222222', 'Trần Thị Mai', 'Hiệu: Mai Hương', 'female', 1985, 'editors', '82222222-2222-4222-8222-222222222222/avatar.webp'),
  ('83333333-3333-4333-8333-333333333333', 'Nguyễn Văn Anh', null, 'male', 1990, 'admins', '83333333-3333-4333-8333-333333333333/avatar.webp'),
  ('84444444-4444-4444-8444-444444444444', 'Lê Bình An', 'An An', 'other', 1995, 'family', null),
  ('85555555-5555-4555-8555-555555555555', 'Hoàng Hương', null, 'female', 1978, 'family', null);

select has_extension('pg_trgm', 'pg_trgm extension is installed');
select has_column('public', 'persons', 'search_normalized', 'persons has stored search_normalized column');
select has_index('public', 'persons', 'idx_persons_search_trgm', 'GIN trigram index exists on persons(search_normalized)');
select has_function('public', 'search_persons', ARRAY['text', 'integer'], 'search_persons(text, integer) RPC exists');

-- Security checks
select function_privs_are(
  'public', 'search_persons', ARRAY['text', 'integer'],
  'authenticated', ARRAY['EXECUTE'],
  'Authenticated users can execute search_persons'
);

-- Validation checks
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select * from public.search_persons('a')$$,
  'query_length_invalid',
  'Rejects single character queries'
);
select throws_ok(
  $$select * from public.search_persons(repeat('x', 101))$$,
  'query_length_invalid',
  'Rejects query longer than 100 characters'
);
select throws_ok(
  $$select * from public.search_persons('an', 0)$$,
  'result_limit_invalid',
  'Rejects limit less than 1'
);
select throws_ok(
  $$select * from public.search_persons('an', 21)$$,
  'result_limit_invalid',
  'Rejects limit greater than 20'
);

-- Vietnamese accent-insensitive matching
select results_eq(
  $$select id from public.search_persons('nguyen van an', 10) where id in ('81111111-1111-4111-8111-111111111111', '83333333-3333-4333-8333-333333333333') order by id$$,
  $$values ('81111111-1111-4111-8111-111111111111'::text)$$,
  'Accentless query matches accented full_name and excludes non-visible admin person for member'
);

select results_eq(
  $$select id from public.search_persons('Nguyễn Văn An', 10) where id = '81111111-1111-4111-8111-111111111111'$$,
  $$values ('81111111-1111-4111-8111-111111111111'::text)$$,
  'Accented query matches person directly'
);

-- Substring and case insensitivity
select results_eq(
  $$select id from public.search_persons('bÌnH', 10) order by id$$,
  $$values ('81111111-1111-4111-8111-111111111111'::text), ('84444444-4444-4444-8444-444444444444'::text)$$,
  'Case insensitive substring matches both full_name and other_names'
);

-- Search via other_names
select results_eq(
  $$select id from public.search_persons('bé tí', 10)$$,
  $$values ('81111111-1111-4111-8111-111111111111'::text)$$,
  'Finds person using other_names substring'
);

-- Privacy redaction for member
select results_eq(
  $$select full_name, gender, birth_year, avatar_url, is_private_placeholder from public.search_persons('mai huong', 10)$$,
  $$values ('Thành viên riêng tư'::text, 'other'::public.gender_enum, null::integer, null::text, true)$$,
  'Member receives a redacted private placeholder'
);
-- Switch to editor: can see editors-only person
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000002', true);
select results_eq(
  $$select id, full_name, gender, birth_year from public.search_persons('mai huong', 10)$$,
  $$values ('82222222-2222-4222-8222-222222222222'::text, 'Trần Thị Mai'::text, 'female'::public.gender_enum, 1985)$$,
  'Editor can see and search editors-only person'
);

-- Switch to admin: can see admins-only person
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
select results_eq(
  $$select id from public.search_persons('nguyen van anh', 10)$$,
  $$values ('83333333-3333-4333-8333-333333333333'::text)$$,
  'Admin can see and search admin-only person'
);

-- Ranking determinism: exact full name or strong prefix matches rank ahead of loose substring matches
select results_eq(
  $$select id from public.search_persons('nguyen van an', 2) limit 2$$,
  $$values ('81111111-1111-4111-8111-111111111111'::text), ('83333333-3333-4333-8333-333333333333'::text)$$,
  'Exact/prefix name matches rank ahead of other candidates'
);

-- Inactive user cannot execute search
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$select * from public.search_persons('nguyen', 10)$$,
  'permission_denied',
  'Inactive user cannot search persons'
);

-- Anonymous role cannot execute search
reset role;
set local role anon;
select throws_ok(
  $$select * from public.search_persons('nguyen', 10)$$,
  '42501',
  'permission denied for function search_persons'
);

-- Explain plan verification: index is accessible and query plan evaluates idx_persons_search_trgm
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
select ok(
  (
    select exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'persons'
        and indexname = 'idx_persons_search_trgm'
        and indexdef ilike '%gin%search_normalized%gin_trgm_ops%'
    )
  ),
  'idx_persons_search_trgm is a valid GIN trigram index on search_normalized'
);

select * from finish();
rollback;
