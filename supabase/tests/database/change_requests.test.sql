begin;
select plan(36);

delete from public.profiles where id in (
  'a0000000-0000-4000-8000-000000000601', 'e0000000-0000-4000-8000-000000000602',
  'b0000000-0000-4000-8000-000000000603', 'c0000000-0000-4000-8000-000000000604',
  'd0000000-0000-4000-8000-000000000605'
);
delete from auth.users where id in (
  'a0000000-0000-4000-8000-000000000601', 'e0000000-0000-4000-8000-000000000602',
  'b0000000-0000-4000-8000-000000000603', 'c0000000-0000-4000-8000-000000000604',
  'd0000000-0000-4000-8000-000000000605'
);
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('a0000000-0000-4000-8000-000000000601', 'authenticated', 'authenticated', 'admin601@example.test', '{}', '{}', now(), now()),
  ('e0000000-0000-4000-8000-000000000602', 'authenticated', 'authenticated', 'editor602@example.test', '{}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-000000000603', 'authenticated', 'authenticated', 'member603@example.test', '{}', '{}', now(), now()),
  ('c0000000-0000-4000-8000-000000000604', 'authenticated', 'authenticated', 'member604@example.test', '{}', '{}', now(), now()),
  ('d0000000-0000-4000-8000-000000000605', 'authenticated', 'authenticated', 'inactive605@example.test', '{}', '{}', now(), now());
insert into public.profiles (id, role, is_active) values
  ('a0000000-0000-4000-8000-000000000601', 'admin', true),
  ('e0000000-0000-4000-8000-000000000602', 'editor', true),
  ('b0000000-0000-4000-8000-000000000603', 'member', true),
  ('c0000000-0000-4000-8000-000000000604', 'member', true),
  ('d0000000-0000-4000-8000-000000000605', 'member', false)
on conflict (id) do update set role = excluded.role, is_active = excluded.is_active;
insert into public.persons (id, full_name, gender, birth_year)
values ('11111111-0000-4000-8000-000000000601', 'Nguyễn Văn Cũ', 'male', 1900)
on conflict (id) do update set full_name = excluded.full_name, gender = excluded.gender, birth_year = excluded.birth_year;
insert into public.sources (id, title, source_type, created_by)
values ('44444444-0000-4000-8000-000000000601', 'Sổ gia đình', 'document', 'a0000000-0000-4000-8000-000000000601')
on conflict (id) do update set title = excluded.title;

set local role anon;
select throws_like(
  $$select id from public.change_requests$$,
  '%permission denied%',
  'Anonymous user cannot read change requests'
);
select throws_like(
  $$select public.submit_change_request('persons', '11111111-0000-4000-8000-000000000601', 'UPDATE', '{"note":"Ẩn danh"}'::jsonb)$$,
  '%permission denied%',
  'Anonymous user cannot submit a change request'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000603","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000603', true);
select lives_ok(
  $$select public.submit_change_request('persons', '11111111-0000-4000-8000-000000000601', 'UPDATE', '{"full_name":"Nguyễn Văn Mới","birth_year":1901}'::jsonb)$$,
  'Member can submit a biographical person correction'
);
select is((select status::text from public.change_requests where target_table = 'persons' order by created_at desc limit 1), 'pending', 'New contribution starts pending');
select is((select requester_id from public.change_requests where target_table = 'persons' order by created_at desc limit 1), 'b0000000-0000-4000-8000-000000000603'::uuid, 'Contribution records its requester');
select isnt((select target_updated_at from public.change_requests where target_table = 'persons' order by created_at desc limit 1), null::timestamptz, 'Person update request records its target baseline');
select throws_like(
  $$select public.submit_change_request('profiles', '11111111-0000-4000-8000-000000000601', 'UPDATE', '{"role":"admin"}'::jsonb)$$,
  '%Unsupported change request target%', 'Role changes are outside contribution scope'
);
select throws_like(
  $$select public.submit_change_request('persons', '11111111-0000-4000-8000-000000000601', 'UPDATE', '{"phone_number":"0900000000"}'::jsonb)$$,
  '%Unsupported person fields%', 'Private person data is outside contribution scope'
);
select throws_like(
  $$select public.submit_change_request('relationships', '11111111-0000-4000-8000-000000000601', 'INSERT', '{"id":"11111111-0000-4000-8000-000000000601"}'::jsonb)$$,
  '%Unsupported change request target%', 'Relationship graph changes are outside contribution scope'
);
select lives_ok(
  $$select public.submit_change_request('custom_events', '22222222-0000-4000-8000-000000000601', 'INSERT', '{"id":"22222222-0000-4000-8000-000000000601","name":"Ngày giỗ","event_date":"2026-09-02","person_id":"11111111-0000-4000-8000-000000000601"}'::jsonb)$$,
  'Member can submit a new custom event'
);
select lives_ok(
  $$select public.submit_change_request('sources', '33333333-0000-4000-8000-000000000601', 'INSERT', '{"id":"33333333-0000-4000-8000-000000000601","title":"Gia phả chi họ","source_type":"book"}'::jsonb)$$,
  'Member can submit a source addition'
);
select lives_ok(
  $$select public.submit_change_request('person_citations', '55555555-0000-4000-8000-000000000601', 'INSERT', '{"id":"55555555-0000-4000-8000-000000000601","person_id":"11111111-0000-4000-8000-000000000601","source_id":"44444444-0000-4000-8000-000000000601","confidence":"primary"}'::jsonb)$$,
  'Member can submit a citation addition'
);
select throws_like(
  $$select public.approve_change_request((select id from public.change_requests where target_table = 'persons' order by created_at desc limit 1), 'Đồng ý')$$,
  '%Access denied%',
  'Member cannot approve a contribution'
);
select is((select count(*)::int from public.change_requests), 4, 'Member sees only own requests through RLS');

select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000604","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000604', true);
select is((select count(*)::int from public.change_requests), 0, 'Another member cannot see requests they did not create');
select lives_ok(
  $$select public.submit_change_request('persons', '11111111-0000-4000-8000-000000000601', 'UPDATE', '{"note":"Bổ sung ghi chú"}'::jsonb)$$,
  'Second member can submit their own request'
);

reset role;
update public.change_requests
set id = '77777777-0000-4000-8000-000000000601'
where requester_id = 'c0000000-0000-4000-8000-000000000604';
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000605","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000605', true);
select throws_like(
  $$select public.submit_change_request('persons', '11111111-0000-4000-8000-000000000601', 'UPDATE', '{"note":"Tài khoản bị vô hiệu"}'::jsonb)$$,
  '%Access denied%',
  'Inactive user cannot submit a change request'
);

select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000602","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000602', true);
select is((select count(*)::int from public.change_requests), 5, 'Editor can review all contribution requests');
select lives_ok(
  $$select public.approve_change_request((select id from public.change_requests where target_table = 'persons' and requester_id = 'b0000000-0000-4000-8000-000000000603' order by created_at limit 1), 'Thông tin phù hợp.')$$,
  'Editor can approve a pending contribution'
);
select is((select full_name from public.persons where id = '11111111-0000-4000-8000-000000000601'), 'Nguyễn Văn Mới', 'Approval applies the person mutation');
select is((select status::text from public.change_requests where target_table = 'persons' and requester_id = 'b0000000-0000-4000-8000-000000000603' order by created_at limit 1), 'approved', 'Approval transitions request atomically to approved');
select is((select reviewer_id from public.change_requests where target_table = 'persons' and requester_id = 'b0000000-0000-4000-8000-000000000603' order by created_at limit 1), 'e0000000-0000-4000-8000-000000000602'::uuid, 'Approval records the reviewer');
select throws_like(
  $$select public.reject_change_request((select id from public.change_requests where target_table = 'custom_events' limit 1), '')$$,
  '%Rejection note is required%',
  'Rejecting without a note is rejected'
);
select lives_ok(
  $$select public.reject_change_request((select id from public.change_requests where target_table = 'custom_events' limit 1), 'Thiếu nội dung sự kiện.')$$,
  'Editor can reject with a note'
);
select is((select count(*)::int from public.custom_events where id = '22222222-0000-4000-8000-000000000601'), 0, 'Rejected event does not mutate domain data');

reset role;
set local session_replication_role = replica;
update public.persons
set privacy_level = 'admins', updated_at = now() + interval '5 seconds'
where id = '11111111-0000-4000-8000-000000000601';
set local session_replication_role = origin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000602","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000602', true);
select is((select count(*)::int from public.change_requests), 1, 'Editor cannot read requests for an admins-only person after privacy changes');
select throws_like(
  $$select public.reject_change_request('77777777-0000-4000-8000-000000000601', 'Không còn quyền xem hồ sơ.')$$,
  '%Access denied%',
  'Editor cannot reject a request after target privacy changes'
);

select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000603","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000603', true);
select lives_ok(
  $$select public.withdraw_change_request((select id from public.change_requests where target_table = 'sources' limit 1))$$,
  'Requester can withdraw their pending request'
);
select is((select status::text from public.change_requests where target_table = 'sources' limit 1), 'withdrawn', 'Withdrawal transitions request to withdrawn');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000601","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000601', true);
select throws_like(
  $$select public.approve_change_request((select id from public.change_requests where target_table = 'sources' limit 1), 'Không thể duyệt.')$$,
  '%not pending%',
  'Withdrawn request cannot be approved'
);
select throws_like(
  $$select public.approve_change_request('77777777-0000-4000-8000-000000000601', 'Đồng ý.')$$,
  '%Conflict%',
  'Stale person request cannot overwrite a newer target version'
);
select is((select status::text from public.change_requests where id = '77777777-0000-4000-8000-000000000601'), 'pending', 'Stale approval keeps request pending');
select is((select note from public.persons where id = '11111111-0000-4000-8000-000000000601'), null::text, 'Stale approval does not overwrite target data');

reset role;
insert into public.change_requests (id, target_table, target_id, operation, proposed_data, requester_id, target_updated_at)
values (
  '66666666-0000-4000-8000-000000000601',
  'persons',
  '11111111-0000-4000-8000-000000000601',
  'UPDATE',
  '{"birth_year":1902,"birth_month":13}'::jsonb,
  'b0000000-0000-4000-8000-000000000603',
  (select updated_at from public.persons where id = '11111111-0000-4000-8000-000000000601')
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000601","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000601', true);
select throws_like(
  $$select public.approve_change_request('66666666-0000-4000-8000-000000000601', 'Duyệt')$$,
  '%persons_birth_month_valid%',
  'Failed domain mutation rejects the approval transaction'
);
select is((select status::text from public.change_requests where id = '66666666-0000-4000-8000-000000000601'), 'pending', 'Failed approval keeps request pending');
select is((select birth_year from public.persons where id = '11111111-0000-4000-8000-000000000601'), 1901, 'Failed approval rolls back the person update');

select * from finish();
rollback;
