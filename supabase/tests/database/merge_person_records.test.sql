begin;
reset role;
select plan(16);

delete from public.profiles where id in ('a4000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000002', 'b4000000-0000-4000-8000-000000000003');
delete from auth.users where id in ('a4000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000002', 'b4000000-0000-4000-8000-000000000003');
delete from public.persons where id in ('41000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000002', '43000000-0000-4000-8000-000000000003', '44000000-0000-4000-8000-000000000004', '45000000-0000-4000-8000-000000000005', '46000000-0000-4000-8000-000000000006', '47000000-0000-4000-8000-000000000007', '48000000-0000-4000-8000-000000000008', '49000000-0000-4000-8000-000000000009', '4a000000-0000-4000-8000-000000000010', '4b000000-0000-4000-8000-000000000011', '4c000000-0000-4000-8000-000000000012');

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a4000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'merge-admin@example.test', '{}', '{}', now(), now()),
  ('e4000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'merge-editor@example.test', '{}', '{}', now(), now()),
  ('b4000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'merge-member@example.test', '{}', '{}', now(), now());
insert into public.profiles (id, role, is_active)
values
  ('a4000000-0000-4000-8000-000000000001', 'admin', true),
  ('e4000000-0000-4000-8000-000000000002', 'editor', true),
  ('b4000000-0000-4000-8000-000000000003', 'member', true)
on conflict (id) do update
set role = excluded.role, is_active = excluded.is_active;

insert into public.persons (id, full_name, gender, note)
values
  ('41000000-0000-4000-8000-000000000001', 'Nguyễn Văn Chính', 'male', 'Bản chính'),
  ('42000000-0000-4000-8000-000000000002', 'Nguyễn Văn Chính', 'male', 'Bản trùng'),
  ('43000000-0000-4000-8000-000000000003', 'Nguyễn Thị Vợ', 'female', null),
  ('44000000-0000-4000-8000-000000000004', 'Nguyễn Văn Con', 'male', null),
  ('45000000-0000-4000-8000-000000000005', 'Nguyễn Văn Cha', 'male', null),
  ('46000000-0000-4000-8000-000000000006', 'Nguyễn Văn Xung đột', 'male', null),
  ('47000000-0000-4000-8000-000000000007', 'Nguyễn Văn Trung gian', 'male', null);
insert into public.relationships (type, person_a, person_b)
values
  ('marriage', '42000000-0000-4000-8000-000000000002', '43000000-0000-4000-8000-000000000003'),
  ('biological_child', '42000000-0000-4000-8000-000000000002', '44000000-0000-4000-8000-000000000004');
insert into public.person_details_private (person_id, phone_number, occupation, current_residence)
values
  ('41000000-0000-4000-8000-000000000001', '0987654321', 'Nghề chính', 'Hà Nội'),
  ('42000000-0000-4000-8000-000000000002', '0901234567', 'Nghề nghiệp từ bản trùng', 'Đà Nẵng');
insert into public.sources (id, title, source_type, created_by)
values ('a4000000-0000-4000-8000-000000000010', 'Sổ gia phả', 'document', 'a4000000-0000-4000-8000-000000000001');
insert into public.person_citations (id, person_id, source_id, confidence, created_by)
values ('a4000000-0000-4000-8000-000000000011', '42000000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-000000000010', 'primary', 'a4000000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b4000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_like(
  $$select public.merge_person_records('41000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000002', '{}'::jsonb)$$,
  '%admin or editor%',
  'Member cannot merge people'
);

select set_config('request.jwt.claims', '{"sub":"e4000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(
  public.merge_person_records('41000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000002', '{"fields":{"note":"duplicate"},"private_fields":{"occupation":"duplicate","phone_number":"primary","current_residence":"duplicate"}}'::jsonb),
  '41000000-0000-4000-8000-000000000001'::uuid,
  'Editor can merge into the chosen primary person'
);
select results_eq($$select count(*)::int from public.persons where id = '42000000-0000-4000-8000-000000000002'$$, $$values (0)$$, 'Duplicate person is deleted');
select results_eq($$select count(*)::int from public.relationships where person_a = '41000000-0000-4000-8000-000000000001' or person_b = '41000000-0000-4000-8000-000000000001'$$, $$values (2)$$, 'Relationships move to the primary person');
select results_eq($$select count(*)::int from public.person_citations where person_id = '41000000-0000-4000-8000-000000000001'$$, $$values (1)$$, 'Citations move to the primary person');
reset role;
select results_eq($q$select occupation from public.person_details_private where person_id = '41000000-0000-4000-8000-000000000001'$q$, $$values ('Nghề nghiệp từ bản trùng')$$, 'Private details move to the primary person');
select results_eq($q$select current_residence from public.person_details_private where person_id = '41000000-0000-4000-8000-000000000001'$q$, $$values ('Đà Nẵng')$$, 'Private residence resolves explicitly');
select results_eq($q$select phone_number from public.person_details_private where person_id = '41000000-0000-4000-8000-000000000001'$q$, $$values ('0987654321')$$, 'Private phone resolves explicitly');
select ok(exists (select 1 from public.audit_log where record_id = '41000000-0000-4000-8000-000000000001' and operation = 'MERGE' and new_data ->> 'action' = 'merge_person_records' and (new_data ->> 'cannot_undo')::boolean = true and (new_data ->> 'undoable')::boolean = false), 'Merge writes a non-undoable MERGE audit entry');

set local role authenticated;
select lives_ok(
  $$insert into public.persons (id, full_name, gender) values ('48000000-0000-4000-8000-000000000008', 'Lê Văn Thử Quyền Index', 'male')$$,
  'Authenticated user can insert person with normalized name functional index'
);
insert into public.persons (id, full_name, gender, birth_year)
values
  ('49000000-0000-4000-8000-000000000009', 'Hoàng Văn Cùng Năm', 'male', 1980),
  ('4a000000-0000-4000-8000-000000000010', 'Hoàng Văn Khác Tên', 'male', 1980);
insert into public.persons (id, full_name, gender)
values
  ('4b000000-0000-4000-8000-000000000011', 'Bùi Văn Cùng Tên', 'male'),
  ('4c000000-0000-4000-8000-000000000012', 'Bùi Văn Cùng Tên', 'male');
select ok((select count(*)::int from public.find_duplicate_candidates(1, 0)) <= 1, 'find_duplicate_candidates honors strict candidate_limit on pair rows');
select results_eq(
  $$select primary_person ->> 'id', duplicate_person ->> 'id' from public.find_duplicate_candidates(1, 0)$$,
  $$values ('49000000-0000-4000-8000-000000000009', '4a000000-0000-4000-8000-000000000010')$$,
  'First duplicate pair page is stable'
);
select results_eq(
  $$select primary_person ->> 'id', duplicate_person ->> 'id' from public.find_duplicate_candidates(1, 1)$$,
  $$values ('4b000000-0000-4000-8000-000000000011', '4c000000-0000-4000-8000-000000000012')$$,
  'Second duplicate pair page is stable'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e4000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

insert into public.relationships (type, person_a, person_b)
values
  ('biological_child', '47000000-0000-4000-8000-000000000007', '45000000-0000-4000-8000-000000000005'),
  ('biological_child', '46000000-0000-4000-8000-000000000006', '47000000-0000-4000-8000-000000000007');
select throws_like(
  $$select public.merge_person_records('45000000-0000-4000-8000-000000000005', '46000000-0000-4000-8000-000000000006', '{"fields":{"full_name":"primary"}}'::jsonb)$$,
  '%cycle%',
  'A relationship cycle aborts the merge'
);
select results_eq($$select count(*)::int from public.persons where id in ('45000000-0000-4000-8000-000000000005', '46000000-0000-4000-8000-000000000006')$$, $$values (2)$$, 'Rollback preserves both people after conflict');
select results_eq($$select count(*)::int from public.relationships where person_a = '46000000-0000-4000-8000-000000000006' and person_b = '47000000-0000-4000-8000-000000000007'$$, $$values (1)$$, 'Rollback preserves the original relationship');

select * from finish();
rollback;
