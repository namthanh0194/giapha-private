begin;
select plan(17);

delete from public.relationships where id between 'f4000000-0000-4000-8000-000000000001' and 'f4000000-0000-4000-8000-000000000999';
delete from public.persons where id between 'f1000000-0000-4000-8000-000000000001' and 'f1000000-0000-4000-8000-000000000999';

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('f0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'graph-member@example.test', '{}', '{}', now(), now()),
  ('f0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'graph-admin@example.test', '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, role, is_active)
values
  ('f0000000-0000-4000-8000-000000000001', 'member', true),
  ('f0000000-0000-4000-8000-000000000002', 'admin', true)
on conflict (id) do update set role = excluded.role, is_active = excluded.is_active;

insert into public.persons (id, full_name, gender, privacy_level, birth_order)
values
  ('f1000000-0000-4000-8000-000000000001', 'Gốc', 'male', 'family', 1),
  ('f1000000-0000-4000-8000-000000000002', 'Vợ thứ nhất', 'female', 'family', 1),
  ('f1000000-0000-4000-8000-000000000003', 'Vợ riêng tư', 'female', 'admins', 2),
  ('f1000000-0000-4000-8000-000000000004', 'Con ruột', 'male', 'family', 1),
  ('f1000000-0000-4000-8000-000000000005', 'Con nuôi', 'female', 'family', 2),
  ('f1000000-0000-4000-8000-000000000006', 'Cháu', 'male', 'family', 1),
  ('f1000000-0000-4000-8000-000000000007', 'Chắt', 'female', 'family', 1)
on conflict (id) do update set full_name = excluded.full_name, privacy_level = excluded.privacy_level;

insert into public.relationships (id, type, person_a, person_b, note)
values
  ('f4000000-0000-4000-8000-000000000001', 'marriage', 'f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', 'Vợ đầu'),
  ('f4000000-0000-4000-8000-000000000002', 'marriage', 'f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000003', 'Riêng tư'),
  ('f4000000-0000-4000-8000-000000000003', 'biological_child', 'f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000004', null),
  ('f4000000-0000-4000-8000-000000000004', 'adopted_child', 'f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000005', null),
  ('f4000000-0000-4000-8000-000000000005', 'biological_child', 'f1000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000006', null),
  ('f4000000-0000-4000-8000-000000000006', 'biological_child', 'f1000000-0000-4000-8000-000000000006', 'f1000000-0000-4000-8000-000000000007', null)
on conflict (id) do nothing;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000001', true);

select is((public.get_family_subtree('f1000000-0000-4000-8000-000000000001', 1, true) ->> 'maxDepth')::int, 1, 'subtree returns requested maxDepth');
select is(jsonb_array_length(public.get_family_subtree('f1000000-0000-4000-8000-000000000001', 1, true) -> 'persons'), 5, 'subtree returns root, children, spouse and placeholder');
select is(jsonb_array_length(public.get_family_subtree('f1000000-0000-4000-8000-000000000001', 1, false) -> 'persons'), 3, 'subtree omits spouses when disabled');
select ok(exists (select 1 from jsonb_array_elements(public.get_family_subtree('f1000000-0000-4000-8000-000000000001', 1, true) -> 'persons') node where node ->> 'full_name' = 'Thành viên riêng tư' and (node ->> 'is_private_placeholder')::boolean), 'private spouse remains opaque');
select ok(not exists (select 1 from jsonb_array_elements(public.get_family_subtree('f1000000-0000-4000-8000-000000000001', 1, true) -> 'persons') node where node ->> 'full_name' = 'Vợ riêng tư'), 'private name is never disclosed');
select ok(exists (select 1 from jsonb_array_elements(public.get_family_subtree('f1000000-0000-4000-8000-000000000001', 1, false) -> 'relationships') edge where edge ->> 'type' = 'adopted_child'), 'subtree includes adoption edges');
select is(jsonb_array_length(public.get_family_subtree('f1000000-0000-4000-8000-000000000001', 1, false) -> 'relationships'), 2, 'max depth excludes deeper edges');
select ok((public.get_family_subtree('f1000000-0000-4000-8000-000000000001', 1, false) ->> 'truncated')::boolean, 'truncated signals more generations');
select is(jsonb_array_length(public.get_family_subtree('f1000000-0000-4000-8000-000000000001', 3, false) -> 'persons'), 5, 'recursive traversal de-duplicates descendants');
select is(jsonb_array_length(public.get_family_subtree('f1000000-0000-4000-8000-000000000999', 1, true) -> 'persons'), 0, 'missing subtree root returns empty graph');
select is(jsonb_array_length(public.get_person_neighborhood('f1000000-0000-4000-8000-000000000004', 1, 1) -> 'persons'), 3, 'neighborhood includes parent and child');
select ok(exists (select 1 from jsonb_array_elements(public.get_person_neighborhood('f1000000-0000-4000-8000-000000000004', 1, 1) -> 'relationships') edge where edge ->> 'person_a' = 'f1000000-0000-4000-8000-000000000001'), 'neighborhood keeps parent edge');
select throws_like($$select public.get_family_subtree('f1000000-0000-4000-8000-000000000001', 0, true)$$, '%max_depth must be between 1 and 10%', 'subtree rejects invalid depth');
select throws_like($$select public.get_person_neighborhood('f1000000-0000-4000-8000-000000000004', 11, 1)$$, '%depth must be between 1 and 10%', 'neighborhood rejects invalid depth');
select throws_like($$insert into public.relationships (type, person_a, person_b) values ('biological_child', 'f1000000-0000-4000-8000-000000000007', 'f1000000-0000-4000-8000-000000000001')$$, '%cycle%', 'Phase 1 relationship rules reject cycles before traversal');

reset role;
insert into public.persons (id, full_name, gender)
select ('f2000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid, 'Giới hạn ' || series, 'other'
from generate_series(1, 2001) series;
insert into public.relationships (type, person_a, person_b)
select 'biological_child', 'f1000000-0000-4000-8000-000000000007', ('f2000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid
from generate_series(1, 2001) series;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000001', true);
select is(jsonb_array_length(public.get_family_subtree('f1000000-0000-4000-8000-000000000007', 1, false) -> 'persons'), 2000, 'subtree enforces 2,000-person limit');
select ok((public.get_family_subtree('f1000000-0000-4000-8000-000000000007', 1, false) ->> 'truncated')::boolean, 'person limit reports truncation');

select * from finish();
rollback;
