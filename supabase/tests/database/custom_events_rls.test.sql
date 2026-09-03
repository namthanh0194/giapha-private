begin;
select plan(14);

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
  ('a0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin@example.test', '{}', '{}', now(), now()),
  ('e0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'editor@example.test', '{}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'member@example.test', '{}', '{}', now(), now()),
  ('c0000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'inactive@example.test', '{}', '{}', now(), now());

insert into public.profiles (id, role, is_active)
values
  ('a0000000-0000-4000-8000-000000000001', 'admin', true),
  ('e0000000-0000-4000-8000-000000000002', 'editor', true),
  ('b0000000-0000-4000-8000-000000000003', 'member', true),
  ('c0000000-0000-4000-8000-000000000004', 'member', false)
on conflict (id) do update
set role = excluded.role, is_active = excluded.is_active;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
select lives_ok($$insert into public.custom_events (name, event_date, created_by) values ('admin', current_date, 'a0000000-0000-4000-8000-000000000001')$$, 'Admin can insert custom events');

select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000002', true);
select lives_ok($$insert into public.custom_events (name, event_date, created_by) values ('editor', current_date, 'e0000000-0000-4000-8000-000000000002')$$, 'Editor can insert custom events');

select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000003', true);
select throws_like($$insert into public.custom_events (name, event_date, created_by) values ('member', current_date, 'b0000000-0000-4000-8000-000000000003')$$, '%row-level security%', 'Member cannot insert custom events');

select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000004', true);
select throws_like($$insert into public.custom_events (name, event_date, created_by) values ('inactive', current_date, 'c0000000-0000-4000-8000-000000000004')$$, '%row-level security%', 'Inactive user cannot insert custom events');

reset role;
set local role anon;
select throws_like($$insert into public.custom_events (name, event_date) values ('anon', current_date)$$, '%row-level security%', 'Anon cannot insert custom events');

-- Test 6: Active member can select custom events
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000003', true);
select results_eq(
  $$select count(*)::int from public.custom_events$$,
  $$values (2)$$,
  'Active member can select custom events'
);

-- Test 6b: Admin can select custom events
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
select results_eq(
  $$select count(*)::int from public.custom_events$$,
  $$values (2)$$,
  'Admin can select custom events'
);

-- Test 6c: Editor can select custom events
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000002', true);
select results_eq(
  $$select count(*)::int from public.custom_events$$,
  $$values (2)$$,
  'Editor can select custom events'
);

-- Test 7: Inactive user cannot select
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000004', true);
select results_eq(
  $$select count(*)::int from public.custom_events$$,
  $$values (0)$$,
  'Inactive user cannot select custom events'
);

-- Test 8: Editor can update own custom event without changing owner
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$update public.custom_events set location = 'Hà Nội' where name = 'editor'$$,
  'Editor can update custom events'
);

-- Test 9: Editor CANNOT reassign created_by to another user
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000002', true);
select throws_like(
  $$update public.custom_events set created_by = 'a0000000-0000-4000-8000-000000000001' where name = 'editor'$$,
  '%Only administrators can change an event owner%',
  'Editor cannot reassign created_by to another user'
);

-- Test 10: Admin CAN reassign created_by
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$update public.custom_events set created_by = 'e0000000-0000-4000-8000-000000000002' where name = 'admin'$$,
  'Admin can reassign created_by'
);

-- Test 11: Editor can delete custom event
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$delete from public.custom_events where name = 'editor'$$,
  'Editor can delete custom events'
);

-- Test 12: Member cannot delete custom event
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000003', true);
select results_eq(
  $$with deleted as (delete from public.custom_events where name = 'admin' returning 1) select count(*)::int from deleted$$,
  $$values (0)$$,
  'Member cannot delete custom events'
);

select * from finish();
rollback;
