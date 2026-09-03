begin;
select plan(44);

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
  ('a0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin-privacy@example.test', '{}', '{}', now(), now()),
  ('e0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'editor-privacy@example.test', '{}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'member-privacy@example.test', '{}', '{}', now(), now()),
  ('c0000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'inactive-privacy@example.test', '{}', '{}', now(), now());

insert into public.profiles (id, role, is_active)
values
  ('a0000000-0000-4000-8000-000000000001', 'admin', true),
  ('e0000000-0000-4000-8000-000000000002', 'editor', true),
  ('b0000000-0000-4000-8000-000000000003', 'member', true),
  ('c0000000-0000-4000-8000-000000000004', 'member', false)
on conflict (id) do update
set role = excluded.role, is_active = excluded.is_active;

insert into public.persons (id, full_name, gender, privacy_level, avatar_url)
values
  ('11111111-1111-4111-8111-111111111111', 'Người trong gia đình', 'male', 'family', '11111111-1111-4111-8111-111111111111/avatar.webp'),
  ('22222222-2222-4222-8222-222222222222', 'Người dành cho biên tập', 'female', 'editors', '22222222-2222-4222-8222-222222222222/avatar.webp'),
  ('33333333-3333-4333-8333-333333333333', 'Người chỉ quản trị', 'other', 'admins', '33333333-3333-4333-8333-333333333333/avatar.webp');

insert into public.relationships (id, type, person_a, person_b, note)
values
  ('41111111-1111-4111-8111-111111111111', 'marriage', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'Không lộ quan hệ editor'),
  ('42222222-2222-4222-8222-222222222222', 'biological_child', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'Không lộ quan hệ admin');

insert into public.person_details_private (person_id, phone_number, occupation, current_residence)
values ('33333333-3333-4333-8333-333333333333', '0900000000', 'Bí mật', 'Địa chỉ bí mật');

insert into public.custom_events (id, name, content, event_date, created_by, person_id)
values
  ('51111111-1111-4111-8111-111111111111', 'Sự kiện chung', 'Công khai trong gia đình', current_date, 'a0000000-0000-4000-8000-000000000001', null),
  ('52222222-2222-4222-8222-222222222222', 'Sự kiện riêng', 'Payload không được lộ', current_date, 'a0000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333');

insert into public.gallery_items (id, title, description, image_url, event_date, created_by, person_id)
values
  ('53333333-3333-4333-8333-333333333333', 'Ảnh gia đình', 'Ảnh chung', 'gallery-family.webp', current_date, 'a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111'),
  ('54444444-4444-4444-8444-444444444444', 'Ảnh admin bí mật', 'Không lộ', 'gallery-admin.webp', current_date, 'a0000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333');

insert into public.sources (id, title, source_type, created_by)
values ('61111111-1111-4111-8111-111111111111', 'Nguồn riêng', 'document', 'a0000000-0000-4000-8000-000000000001');
insert into public.person_citations (id, person_id, source_id, field_name, quotation, confidence, created_by)
values ('62222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '61111111-1111-4111-8111-111111111111', 'note', 'Tên và payload bí mật', 'primary', 'a0000000-0000-4000-8000-000000000001');

select col_type_is('public', 'persons', 'privacy_level', 'text', 'persons.privacy_level is text');
select ok(
  (select pg_get_expr(polqual, polrelid) ilike '%can_view_person%' from pg_policy where polrelid = 'storage.objects'::regclass and polname = 'Authenticated users can view visible avatars'),
  'Avatar storage SELECT policy maps objects through can_view_person'
);
select ok(
  (select pg_get_expr(polqual, polrelid) ilike '%can_view_person%' from pg_policy where polrelid = 'storage.objects'::regclass and polname = 'Authenticated users can view visible gallery objects'),
  'Gallery storage SELECT policy maps objects through can_view_person'
);
select col_not_null('public', 'persons', 'privacy_level', 'persons.privacy_level is not null');
select col_default_is('public', 'persons', 'privacy_level', 'family', 'persons.privacy_level defaults to family');
select throws_like(
  $$insert into public.persons (full_name, gender, privacy_level) values ('Sai privacy', 'male', 'private')$$,
  '%persons_privacy_level_chk%',
  'Privacy level check rejects unknown values'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
select results_eq($$select full_name from public.persons order by full_name$$, $$values ('Người chỉ quản trị'::text), ('Người dành cho biên tập'::text), ('Người trong gia đình'::text)$$, 'Admin reads all privacy levels');
select results_eq($$select count(*)::int from public.relationships$$, $$values (2)$$, 'Admin reads all relationships');
select results_eq($$select phone_number from public.person_details_private$$, $$values ('0900000000'::text)$$, 'Admin reads private details');
select results_eq($$select count(*)::int from public.custom_events$$, $$values (2)$$, 'Admin reads person-scoped events');
select results_eq($$select count(*)::int from public.gallery_items$$, $$values (2)$$, 'Admin reads all gallery items');
select results_eq($$select quotation from public.person_citations$$, $$values ('Tên và payload bí mật'::text)$$, 'Admin reads hidden-person citations');
select isnt_empty($$select * from public.audit_log$$, 'Admin can read audit log');

select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000002', true);
select results_eq($$select full_name from public.persons order by full_name$$, $$values ('Người dành cho biên tập'::text), ('Người trong gia đình'::text)$$, 'Editor reads family and editors privacy levels');
select results_eq($$select count(*)::int from public.relationships$$, $$values (1)$$, 'Editor cannot read relationship containing admins-only person');
select results_eq($$select count(*)::int from public.custom_events$$, $$values (1)$$, 'Editor cannot read event scoped to admins-only person');
select results_eq($$select count(*)::int from public.gallery_items$$, $$values (1)$$, 'Editor cannot read gallery item scoped to admins-only person');
select results_eq($$select count(*)::int from public.person_citations$$, $$values (0)$$, 'Editor cannot read citation payload for admins-only person');
select results_eq($$select count(*)::int from public.person_details_private$$, $$values (0)$$, 'Editor cannot read private details');
select is_empty($$select p.full_name from public.relationships r join public.persons p on p.id in (r.person_a, r.person_b) where p.privacy_level = 'admins'$$, 'Editor join cannot leak admins-only person name');
select isnt_empty($$select * from public.audit_log$$, 'Editor can read audit log');

select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000003', true);
select results_eq($$select full_name from public.persons$$, $$values ('Người trong gia đình'::text)$$, 'Member reads only family privacy level');
select results_eq($$select count(*)::int from public.relationships$$, $$values (0)$$, 'Member cannot infer hidden people through relationships');
select results_eq($$select count(*)::int from public.custom_events$$, $$values (1)$$, 'Member reads only unscoped visible custom event');
select results_eq($$select count(*)::int from public.gallery_items$$, $$values (1)$$, 'Member reads only family gallery item');
select results_eq($$select count(*)::int from public.person_citations$$, $$values (0)$$, 'Member cannot read hidden citation payload');
select results_eq($$select count(*)::int from public.person_details_private$$, $$values (0)$$, 'Member cannot read private details');
select is_empty($$select r.note from public.relationships r where r.note like '%Không lộ%'$$, 'Member cannot read relationship notes linked to hidden people');
select is_empty($$select * from public.audit_log$$, 'Member cannot read audit log table');

-- Test topology RPC for member
select is(
  (select count(*)::int from jsonb_array_elements((public.get_family_tree_topology() -> 'persons')) where value ->> 'full_name' = 'Thành viên riêng tư'),
  2,
  'Topology RPC exposes 2 private placeholder nodes to preserve structure for member'
);
select is(
  (select (value ->> 'is_private_placeholder')::boolean from jsonb_array_elements((public.get_family_tree_topology() -> 'persons')) where value ->> 'full_name' = 'Thành viên riêng tư' limit 1),
  true,
  'Topology RPC marks hidden nodes with is_private_placeholder true'
);
select is(
  (select count(*)::int from jsonb_array_elements((public.get_family_tree_topology() -> 'relationships'))),
  2,
  'Topology RPC preserves all 2 edges without breaking tree connectivity'
);

select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000004', true);
select results_eq($$select count(*)::int from public.persons$$, $$values (0)$$, 'Inactive user cannot read persons');
select results_eq($$select count(*)::int from public.relationships$$, $$values (0)$$, 'Inactive user cannot read relationships');
select results_eq($$select count(*)::int from public.custom_events$$, $$values (0)$$, 'Inactive user cannot read custom events');
select results_eq($$select count(*)::int from public.person_citations$$, $$values (0)$$, 'Inactive user cannot read citations');
select results_eq($$select count(*)::int from public.audit_log$$, $$values (0)$$, 'Inactive user cannot read audit log');

reset role;
set local role anon;
select results_eq($$select count(*)::int from public.persons$$, $$values (0)$$, 'Anonymous user cannot read persons');
select results_eq($$select count(*)::int from public.relationships$$, $$values (0)$$, 'Anonymous user cannot read relationships');
select results_eq($$select count(*)::int from public.custom_events$$, $$values (0)$$, 'Anonymous user cannot read custom events');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
select is(
  public.restore_backup(jsonb_build_object(
    'version', 5,
    'persons', jsonb_build_array(jsonb_build_object('id', '71111111-1111-4111-8111-111111111111', 'full_name', 'Khôi phục riêng tư', 'gender', 'female', 'privacy_level', 'admins')),
    'relationships', '[]'::jsonb,
    'custom_events', jsonb_build_array(jsonb_build_object('id', '72222222-2222-4222-8222-222222222222', 'name', 'Sự kiện khôi phục', 'event_date', current_date, 'person_id', '71111111-1111-4111-8111-111111111111')),
    'gallery_items', jsonb_build_array(jsonb_build_object('id', '73333333-3333-4333-8333-333333333333', 'title', 'Ảnh khôi phục', 'image_url', 'restored.jpg', 'person_id', '71111111-1111-4111-8111-111111111111'))
  )),
  jsonb_build_object('persons', 1, 'relationships', 0, 'person_details_private', 0, 'custom_events', 1, 'sources', 0, 'person_citations', 0, 'gallery_items', 1),
  'Version 5 backup restores privacy, person-scoped events and gallery items'
);
select results_eq($$select privacy_level from public.persons where id = '71111111-1111-4111-8111-111111111111'$$, $$values ('admins'::text)$$, 'Full backup preserves privacy level');
select results_eq($$select person_id from public.custom_events where id = '72222222-2222-4222-8222-222222222222'$$, $$values ('71111111-1111-4111-8111-111111111111'::uuid)$$, 'Full backup preserves custom event person scope');
select results_eq($$select person_id from public.gallery_items where id = '73333333-3333-4333-8333-333333333333'$$, $$values ('71111111-1111-4111-8111-111111111111'::uuid)$$, 'Full backup preserves gallery item person linkage');

select * from finish();
rollback;
