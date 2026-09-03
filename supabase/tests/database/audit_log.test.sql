begin;
select plan(23);

select has_table('public', 'audit_log', 'Audit log table exists');
select has_function('public', 'write_audit_log', array[]::text[], 'Audit trigger function exists');
select has_function('public', 'prevent_audit_log_truncation', array[]::text[], 'Audit truncate guard exists');
select is(
  has_function_privilege('anon', 'public.write_audit_log()', 'EXECUTE'),
  false,
  'Anonymous role cannot execute the audit trigger function'
);
select is(
  has_function_privilege('authenticated', 'public.write_audit_log()', 'EXECUTE'),
  false,
  'Authenticated role cannot execute the audit trigger function'
);

select throws_like(
  $$truncate public.audit_log$$,
  '%Audit log cannot be truncated%',
  'Audit log rejects truncate even for its owner'
);
select is(
  (select tgenabled::text from pg_trigger where tgname = 'tr_prevent_audit_log_truncate'),
  'A',
  'Audit truncate guard remains enabled during replication sessions'
);

create schema audit_spoof;
create table audit_spoof.persons (
  id uuid primary key,
  full_name text not null
);
create trigger tr_spoof_audit
after insert or update or delete on audit_spoof.persons
for each row execute function public.write_audit_log();
select throws_like(
  $$insert into audit_spoof.persons (id, full_name) values ('90000000-0000-4000-8000-000000000109', 'Giả mạo')$$,
  '%Unsupported audit trigger source%',
  'Audit trigger rejects tables outside the public allowlist'
);

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'audit-admin@example.test', '{}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'audit-member@example.test', '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, role, is_active)
values
  ('a0000000-0000-4000-8000-000000000101', 'admin', true),
  ('b0000000-0000-4000-8000-000000000102', 'member', true)
on conflict (id) do update set role = excluded.role, is_active = excluded.is_active;

set local role service_role;
delete from public.audit_log;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000101","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000101', true);

insert into public.persons (id, full_name, gender)
values ('10000000-0000-4000-8000-000000000101', 'Nguyễn Văn Audit', 'male');

select results_eq(
  $$select table_name, record_id, operation, actor_user_id from public.audit_log where table_name = 'persons' and record_id = '10000000-0000-4000-8000-000000000101' order by id$$,
  $$values ('persons'::text, '10000000-0000-4000-8000-000000000101'::uuid, 'INSERT'::text, 'a0000000-0000-4000-8000-000000000101'::uuid)$$,
  'Person insert writes an audit entry with actor'
);

update public.persons set full_name = 'Nguyễn Văn Đã cập nhật' where id = '10000000-0000-4000-8000-000000000101';
select ok(
  (select old_data ->> 'full_name' = 'Nguyễn Văn Audit' and new_data ->> 'full_name' = 'Nguyễn Văn Đã cập nhật' from public.audit_log where table_name = 'persons' and operation = 'UPDATE' order by id desc limit 1),
  'Person update stores old and new snapshots'
);

insert into public.persons (id, full_name, gender)
values ('20000000-0000-4000-8000-000000000102', 'Trần Thị Audit', 'female');
insert into public.relationships (id, type, person_a, person_b)
values ('30000000-0000-4000-8000-000000000103', 'marriage', '10000000-0000-4000-8000-000000000101', '20000000-0000-4000-8000-000000000102');
select is(
  (select operation from public.audit_log where table_name = 'relationships' and record_id = '30000000-0000-4000-8000-000000000103' order by id desc limit 1),
  'INSERT',
  'Relationship insert writes an audit entry'
);

delete from public.relationships where id = '30000000-0000-4000-8000-000000000103';
select is(
  (select operation from public.audit_log where table_name = 'relationships' and record_id = '30000000-0000-4000-8000-000000000103' order by id desc limit 1),
  'DELETE',
  'Relationship delete writes an audit entry'
);

insert into public.custom_events (id, name, event_date, created_by)
values ('40000000-0000-4000-8000-000000000104', 'Ngày họp Audit', current_date, 'a0000000-0000-4000-8000-000000000101');
select is(
  (select operation from public.audit_log where table_name = 'custom_events' and record_id = '40000000-0000-4000-8000-000000000104' order by id desc limit 1),
  'INSERT',
  'Custom event insert writes an audit entry'
);

insert into public.gallery_items (id, title, image_url, created_by)
values ('50000000-0000-4000-8000-000000000105', 'Ảnh Audit', 'gallery/audit.webp', 'a0000000-0000-4000-8000-000000000101');
select is(
  (select operation from public.audit_log where table_name = 'gallery_items' and record_id = '50000000-0000-4000-8000-000000000105' order by id desc limit 1),
  'INSERT',
  'Gallery insert writes an audit entry'
);

update public.profiles set role = 'editor' where id = 'b0000000-0000-4000-8000-000000000102';
select is(
  (select operation from public.audit_log where table_name = 'profiles' and record_id = 'b0000000-0000-4000-8000-000000000102' order by id desc limit 1),
  'UPDATE',
  'Profile update writes an audit entry'
);

insert into public.person_details_private (person_id, phone_number, occupation, current_residence)
values ('10000000-0000-4000-8000-000000000101', '0900000000', 'Nghề cũ', 'Địa chỉ cũ');
update public.person_details_private set phone_number = '0911111111', occupation = 'Nghề mới' where person_id = '10000000-0000-4000-8000-000000000101';
select ok(
  (select new_data ? 'changed_fields' and new_data -> 'changed_fields' @> '["phone_number", "occupation"]'::jsonb and new_data::text not like '%0911111111%' from public.audit_log where table_name = 'person_details_private' and operation = 'UPDATE' order by id desc limit 1),
  'Private detail audit records changed keys without raw values'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000102","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000102', true);

select throws_like($$insert into public.audit_log (table_name, record_id, operation) values ('persons', '10000000-0000-4000-8000-000000000101', 'INSERT')$$, '%permission denied%', 'Authenticated users cannot insert audit rows');
select throws_like($$update public.audit_log set table_name = 'profiles' where table_name = 'persons'$$, '%permission denied%', 'Authenticated users cannot update audit rows');
select throws_like($$delete from public.audit_log where table_name = 'persons'$$, '%permission denied%', 'Authenticated users cannot delete audit rows');

reset role;
set local role anon;
select throws_like($$insert into public.audit_log (table_name, record_id, operation) values ('persons', '10000000-0000-4000-8000-000000000101', 'INSERT')$$, '%permission denied%', 'Anonymous users cannot insert audit rows');
select throws_like($$update public.audit_log set table_name = 'profiles'$$, '%permission denied%', 'Anonymous users cannot update audit rows');
select throws_like($$delete from public.audit_log$$, '%permission denied%', 'Anonymous users cannot delete audit rows');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000101","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000101', true);
select results_eq(
  $$select count(*)::int > 0 from public.audit_log where table_name in ('profiles', 'person_details_private')$$,
  $$values (true)$$,
  'Administrators can read all audit entries'
);

select * from finish();
rollback;
