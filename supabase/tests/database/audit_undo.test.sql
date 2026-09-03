begin;
select plan(26);

delete from public.profiles
where id in (
  'a0000000-0000-4000-8000-000000000201',
  'e0000000-0000-4000-8000-000000000202',
  'b0000000-0000-4000-8000-000000000203',
  'c0000000-0000-4000-8000-000000000204'
);
delete from auth.users
where id in (
  'a0000000-0000-4000-8000-000000000201',
  'e0000000-0000-4000-8000-000000000202',
  'b0000000-0000-4000-8000-000000000203',
  'c0000000-0000-4000-8000-000000000204'
);

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000201', 'authenticated', 'authenticated', 'admin201@example.test', '{}', '{}', now(), now()),
  ('e0000000-0000-4000-8000-000000000202', 'authenticated', 'authenticated', 'editor202@example.test', '{}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-000000000203', 'authenticated', 'authenticated', 'member203@example.test', '{}', '{}', now(), now()),
  ('c0000000-0000-4000-8000-000000000204', 'authenticated', 'authenticated', 'inactive204@example.test', '{}', '{}', now(), now());

insert into public.profiles (id, role, is_active)
values
  ('a0000000-0000-4000-8000-000000000201', 'admin', true),
  ('e0000000-0000-4000-8000-000000000202', 'editor', true),
  ('b0000000-0000-4000-8000-000000000203', 'member', true),
  ('c0000000-0000-4000-8000-000000000204', 'member', false)
on conflict (id) do update
set role = excluded.role, is_active = excluded.is_active;

-- 1. Anonymous cannot call undo_audit_entry
reset role;
set local role anon;
select throws_like(
  $$select public.undo_audit_entry(1)$$,
  '%permission denied%',
  'Anonymous role cannot execute undo_audit_entry'
);

-- 2. Member cannot call undo_audit_entry
reset role;
grant execute on function public.normalize_duplicate_name(text) to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000203","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000203', true);
select throws_like(
  $$select public.undo_audit_entry(1)$$,
  '%Access denied%',
  'Active member cannot execute undo_audit_entry'
);

-- 3. Inactive user cannot call undo_audit_entry
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000204","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000204', true);
select throws_like(
  $$select public.undo_audit_entry(1)$$,
  '%Access denied%',
  'Inactive user cannot execute undo_audit_entry'
);

-- Setup domain rows as editor
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000202","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000202', true);

insert into public.persons (id, full_name, gender, birth_year)
values
  ('11111111-0000-4000-8000-000000000201', 'Cụ Tổ', 'male', 1900),
  ('22222222-0000-4000-8000-000000000202', 'Cụ Bà', 'female', 1905);

-- 4. Undo persons UPDATE
update public.persons set full_name = 'Cụ Tổ (Đã đổi)' where id = '11111111-0000-4000-8000-000000000201';
select lives_ok(
  $$select public.undo_audit_entry((select id from public.audit_log where table_name = 'persons' and operation = 'UPDATE' and record_id = '11111111-0000-4000-8000-000000000201' order by id desc limit 1))$$,
  'Editor can undo persons UPDATE'
);
select is(
  (select full_name from public.persons where id = '11111111-0000-4000-8000-000000000201'),
  'Cụ Tổ',
  'Undone person restored old full_name'
);

-- 5. Reject unsupported persons INSERT undo
select throws_like(
  $$select public.undo_audit_entry((select id from public.audit_log where table_name = 'persons' and operation = 'INSERT' and record_id = '11111111-0000-4000-8000-000000000201' order by id desc limit 1))$$,
  '%Undo is not supported for this change type%',
  'Persons INSERT undo is rejected'
);

-- 6. Undo relationships INSERT (deletes inserted relationship)
insert into public.relationships (id, type, person_a, person_b)
values ('33333333-0000-4000-8000-000000000203', 'marriage', '11111111-0000-4000-8000-000000000201', '22222222-0000-4000-8000-000000000202');
select lives_ok(
  $$select public.undo_audit_entry((select id from public.audit_log where table_name = 'relationships' and operation = 'INSERT' and record_id = '33333333-0000-4000-8000-000000000203' order by id desc limit 1))$$,
  'Undo relationships INSERT deletes relationship'
);
select is(
  (select count(*)::int from public.relationships where id = '33333333-0000-4000-8000-000000000203'),
  0,
  'Relationship row removed by undo'
);

-- 7. Undo relationships DELETE (recreates deleted relationship)
delete from public.relationships where id = '33333333-0000-4000-8000-000000000203';
insert into public.relationships (id, type, person_a, person_b)
values ('33333333-0000-4000-8000-000000000203', 'marriage', '11111111-0000-4000-8000-000000000201', '22222222-0000-4000-8000-000000000202');
delete from public.relationships where id = '33333333-0000-4000-8000-000000000203';
select lives_ok(
  $$select public.undo_audit_entry((select id from public.audit_log where table_name = 'relationships' and operation = 'DELETE' and record_id = '33333333-0000-4000-8000-000000000203' order by id desc limit 1))$$,
  'Undo relationships DELETE restores relationship'
);
select is(
  (select count(*)::int from public.relationships where id = '33333333-0000-4000-8000-000000000203'),
  1,
  'Relationship row recreated by undo'
);

-- 8. Undo custom_events INSERT (deletes event)
insert into public.custom_events (id, name, event_date, created_by, person_id)
values ('44444444-0000-4000-8000-000000000204', 'Lễ Giỗ', current_date, 'e0000000-0000-4000-8000-000000000202', '11111111-0000-4000-8000-000000000201');
select lives_ok(
  $$select public.undo_audit_entry((select id from public.audit_log where table_name = 'custom_events' and operation = 'INSERT' and record_id = '44444444-0000-4000-8000-000000000204' order by id desc limit 1))$$,
  'Undo custom_events INSERT succeeds'
);
select is(
  (select count(*)::int from public.custom_events where id = '44444444-0000-4000-8000-000000000204'),
  0,
  'Custom event deleted by undo'
);

-- 9. Undo custom_events UPDATE & DELETE
delete from public.custom_events where id = '44444444-0000-4000-8000-000000000204';
insert into public.custom_events (id, name, event_date, created_by, person_id)
values ('44444444-0000-4000-8000-000000000204', 'Lễ Giỗ Gốc', current_date, 'e0000000-0000-4000-8000-000000000202', '11111111-0000-4000-8000-000000000201');
update public.custom_events
set name = 'Lễ Giỗ Sửa', person_id = '22222222-0000-4000-8000-000000000202'
where id = '44444444-0000-4000-8000-000000000204';
select lives_ok(
  $$select public.undo_audit_entry((select id from public.audit_log where table_name = 'custom_events' and operation = 'UPDATE' and record_id = '44444444-0000-4000-8000-000000000204' order by id desc limit 1))$$,
  'Undo custom_events UPDATE succeeds'
);
select is(
  (select name from public.custom_events where id = '44444444-0000-4000-8000-000000000204'),
  'Lễ Giỗ Gốc',
  'Custom event name restored by undo'
);
select is(
  (select person_id from public.custom_events where id = '44444444-0000-4000-8000-000000000204'),
  '11111111-0000-4000-8000-000000000201'::uuid,
  'Custom event person_id restored by UPDATE undo'
);
delete from public.custom_events where id = '44444444-0000-4000-8000-000000000204';
select lives_ok(
  $$select public.undo_audit_entry((select id from public.audit_log where table_name = 'custom_events' and operation = 'DELETE' and record_id = '44444444-0000-4000-8000-000000000204' order by id desc limit 1))$$,
  'Undo custom_events DELETE succeeds'
);
select is(
  (select count(*)::int from public.custom_events where id = '44444444-0000-4000-8000-000000000204'),
  1,
  'Custom event restored after delete'
);
select is(
  (select person_id from public.custom_events where id = '44444444-0000-4000-8000-000000000204'),
  '11111111-0000-4000-8000-000000000201'::uuid,
  'Custom event person_id restored by DELETE undo'
);

-- Setup gallery item as Admin
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000201","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000201', true);
insert into public.gallery_items (id, title, description, image_url, created_by)
values ('55555555-0000-4000-8000-000000000205', 'Ảnh Gia Phả', 'Mô tả gốc', 'gallery/original.webp', 'a0000000-0000-4000-8000-000000000201');

-- 10. Editor cannot undo gallery metadata update (Admin-only domain)
update public.gallery_items set title = 'Ảnh Đổi Tên' where id = '55555555-0000-4000-8000-000000000205';
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000202","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000202', true);
select throws_like(
  $$select public.undo_audit_entry((select id from public.audit_log where table_name = 'gallery_items' and operation = 'UPDATE' and record_id = '55555555-0000-4000-8000-000000000205' order by id desc limit 1))$$,
  '%Access denied%',
  'Editor cannot undo gallery_items UPDATE'
);

-- 11. Admin undoes gallery metadata update without altering image_url/storage
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000201","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000201', true);
select lives_ok(
  $$select public.undo_audit_entry((select id from public.audit_log where table_name = 'gallery_items' and operation = 'UPDATE' and record_id = '55555555-0000-4000-8000-000000000205' order by id desc limit 1))$$,
  'Admin can undo gallery metadata UPDATE'
);
select is(
  (select title from public.gallery_items where id = '55555555-0000-4000-8000-000000000205'),
  'Ảnh Gia Phả',
  'Gallery title restored'
);
select is(
  (select image_url from public.gallery_items where id = '55555555-0000-4000-8000-000000000205'),
  'gallery/original.webp',
  'Gallery image_url remains untouched'
);

-- 12. Conflict detection: stale audit entry cannot overwrite concurrent changes
update public.persons set full_name = 'Cụ Tổ V2' where id = '11111111-0000-4000-8000-000000000201';
create temporary table audit_undo_test_ids (id bigint primary key);
insert into audit_undo_test_ids
select id from public.audit_log
where table_name = 'persons' and operation = 'UPDATE' and record_id = '11111111-0000-4000-8000-000000000201'
order by id desc limit 1;
update public.persons set full_name = 'Cụ Tổ V3' where id = '11111111-0000-4000-8000-000000000201';
select throws_like(
  $$select public.undo_audit_entry((select id from audit_undo_test_ids limit 1))$$,
  '%Conflict detected%',
  'Stale undo is rejected when current row does not match new_data'
);

-- 13. Audit chain: new audit entry is recorded with undone_audit_id metadata
select ok(
  (select count(*)::int > 0 from public.audit_log where undone_audit_id is not null),
  'Undo produces an audit log entry referencing the undone audit id'
);

-- 14. 24h window expiration check
reset role;
update public.audit_log
set occurred_at = now() - interval '25 hours'
where id = (select id from public.audit_log where table_name = 'persons' and operation = 'UPDATE' order by id desc limit 1);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000201","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000201', true);

select throws_like(
  $$select public.undo_audit_entry((select id from public.audit_log where table_name = 'persons' and operation = 'UPDATE' order by id desc limit 1))$$,
  '%Undo window has expired%',
  'Undo after 24 hours is rejected'
);

-- 15. Gallery storage-path changes are explicitly unsupported
update public.gallery_items
set image_url = 'gallery/replaced.webp'
where id = '55555555-0000-4000-8000-000000000205';
select throws_like(
  $$select public.undo_audit_entry((select id from public.audit_log where table_name = 'gallery_items' and operation = 'UPDATE' and record_id = '55555555-0000-4000-8000-000000000205' order by id desc limit 1))$$,
  '%gallery storage or ownership changes%',
  'Gallery image_url undo is rejected'
);

select * from finish();
rollback;

