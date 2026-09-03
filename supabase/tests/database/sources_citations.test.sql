begin;
select plan(43);

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

insert into public.persons (id, full_name, gender)
values
  ('11111111-1111-4111-8111-111111111111', 'Trần Văn Tổ', 'male'),
  ('22222222-2222-4222-8222-222222222222', 'Trần Thị Nhánh', 'female')
on conflict (id) do nothing;

insert into public.sources (id, title, source_type, created_by)
values ('aaaaaaaa-0000-4000-8000-000000000010', 'Nguồn RPC ban đầu', 'document', 'a0000000-0000-4000-8000-000000000001');
insert into public.person_citations (id, person_id, source_id, field_name, confidence, created_by)
values ('cccccccc-0000-4000-8000-000000000010', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000010', 'note', 'uncertain', 'a0000000-0000-4000-8000-000000000001');

select results_eq(
  $$select prosecdef from pg_proc where oid = 'public.save_source_and_citation(jsonb,jsonb,uuid,uuid,integer,integer)'::regprocedure$$,
  $$values (true)$$,
  'save_source_and_citation is SECURITY DEFINER'
);

set local role anon;
select throws_like(
  $$select public.save_source_and_citation('{}'::jsonb, '{}'::jsonb, null::uuid, null::uuid, null::integer, null::integer)$$,
  '%permission denied%',
  'Anon cannot execute save_source_and_citation'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000003', true);
select throws_like(
  $$select public.save_source_and_citation(jsonb_build_object('title', 'Member source', 'source_type', 'other'), jsonb_build_object('person_id', '11111111-1111-4111-8111-111111111111'), null, null, null, null)$$,
  '%Access denied%',
  'Member cannot execute save_source_and_citation'
);

select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000004', true);
select throws_like(
  $$select public.save_source_and_citation(jsonb_build_object('title', 'Inactive source', 'source_type', 'other'), jsonb_build_object('person_id', '11111111-1111-4111-8111-111111111111'), null, null, null, null)$$,
  '%Access denied%',
  'Inactive profile cannot execute save_source_and_citation'
);

select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$select public.save_source_and_citation(jsonb_build_object('title', 'Nguồn RPC admin', 'source_type', 'book'), jsonb_build_object('person_id', '11111111-1111-4111-8111-111111111111', 'field_name', 'birth_date', 'confidence', 'primary'), null, null, null, null)$$,
  'Admin creates source and citation through RPC'
);

select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$select public.save_source_and_citation(jsonb_build_object('title', 'Nguồn RPC editor', 'source_type', 'other'), jsonb_build_object('person_id', '22222222-2222-4222-8222-222222222222', 'field_name', 'note', 'confidence', 'secondary'), null, null, null, null)$$,
  'Editor creates source and citation through RPC'
);

select lives_ok(
  $$select public.save_source_and_citation(jsonb_build_object('title', 'Nguồn RPC đã sửa', 'source_type', 'document'), jsonb_build_object('person_id', '11111111-1111-4111-8111-111111111111', 'field_name', 'death_date', 'confidence', 'primary'), 'aaaaaaaa-0000-4000-8000-000000000010', 'cccccccc-0000-4000-8000-000000000010', 1, 1)$$,
  'Editor updates source and citation through RPC'
);

select throws_like(
  $$select public.save_source_and_citation(jsonb_build_object('title', 'Thiếu citation ID', 'source_type', 'other'), jsonb_build_object('person_id', '11111111-1111-4111-8111-111111111111'), 'aaaaaaaa-0000-4000-8000-000000000010', null, null, null)$$,
  '%identifiers must be provided together%',
  'RPC rejects incomplete source and citation identifiers'
);

select throws_like(
  $$select public.save_source_and_citation(jsonb_build_object('title', 'Sai UUID', 'source_type', 'other'), jsonb_build_object('person_id', 'not-a-uuid'), null, null, null, null)$$,
  '%invalid input syntax for type uuid%',
  'RPC rejects wrong person identifier type'
);

select throws_like(
  $$select public.save_source_and_citation(jsonb_build_object('title', '', 'source_type', 'invalid'), jsonb_build_object('person_id', '11111111-1111-4111-8111-111111111111'), null, null, null, null)$$,
  '%check constraint%',
  'RPC rejects invalid source data'
);

select throws_like(
  $$select public.save_source_and_citation(jsonb_build_object('title', 'Nguồn phải rollback', 'source_type', 'other'), jsonb_build_object('person_id', '11111111-1111-4111-8111-111111111111', 'confidence', 'invalid'), null, null, null, null)$$,
  '%person_citations_confidence_chk%',
  'RPC rejects invalid citation after source insert'
);
select results_eq(
  $$select count(*)::int from public.sources where title = 'Nguồn phải rollback'$$,
  $$values (0)$$,
  'Source insert rolls back when citation is invalid'
);

select throws_like(
  $$select public.save_source_and_citation(jsonb_build_object('title', 'Nguồn update phải rollback', 'source_type', 'document'), jsonb_build_object('person_id', '11111111-1111-4111-8111-111111111111', 'confidence', 'invalid'), 'aaaaaaaa-0000-4000-8000-000000000010', 'cccccccc-0000-4000-8000-000000000010', 2, 2)$$,
  '%person_citations_confidence_chk%',
  'RPC rejects invalid citation after source update'
);
select results_eq(
  $$select title from public.sources where id = 'aaaaaaaa-0000-4000-8000-000000000010'$$,
  $$values ('Nguồn RPC đã sửa'::text)$$,
  'Source update rolls back when citation is invalid'
);

-- 1. Admin can insert source
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$insert into public.sources (id, title, source_type, author, url, created_by)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'Gia phả họ Trần 1930', 'document', 'Trần Cụ', 'https://example.com/source.pdf', 'a0000000-0000-4000-8000-000000000001')$$,
  'Admin can insert source'
);

-- 2. Editor can insert citation linked to existing person and source
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$insert into public.person_citations (id, person_id, source_id, field_name, page_reference, confidence, created_by)
    values ('cccccccc-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000001', 'birth_date', 'Trang 12', 'primary', 'e0000000-0000-4000-8000-000000000002')$$,
  'Editor can insert person citation'
);

-- 3. Duplicate citation is rejected
select throws_like(
  $$insert into public.person_citations (person_id, source_id, field_name, page_reference, confidence, created_by)
    values ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000001', 'birth_date', 'Trang 12', 'primary', 'e0000000-0000-4000-8000-000000000002')$$,
  '%duplicate%',
  'Duplicate identical citation rejected'
);

-- 4. Member cannot insert source
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000003', true);
select throws_like(
  $$insert into public.sources (title, source_type, created_by) values ('Sổ tay member', 'other', 'b0000000-0000-4000-8000-000000000003')$$,
  '%row-level security%',
  'Member cannot insert source'
);

-- 5. Inactive user cannot select sources
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000004', true);
select results_eq(
  $$select count(*)::int from public.sources where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  $$values (0)$$,
  'Inactive user cannot select sources'
);

-- 6. Active member can select sources and citations
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000003', true);
select results_eq(
  $$select count(*)::int from public.sources where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  $$values (1)$$,
  'Active member can select sources'
);

select results_eq(
  $$select count(*)::int from public.person_citations where id = 'cccccccc-0000-4000-8000-000000000001'$$,
  $$values (1)$$,
  'Active member can select person citations'
);

-- 8. Anon cannot select sources
reset role;
set local role anon;
select throws_like(
  $$select count(*)::int from public.sources$$,
  '%permission denied%',
  'Anon cannot select sources'
);

-- 9. Non-HTTP(S) URL rejected on source
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
select throws_like(
  $$insert into public.sources (title, source_type, url, created_by)
    values ('Bad URL', 'website', 'javascript:alert(1)', 'a0000000-0000-4000-8000-000000000001')$$,
  '%sources_url_protocol_chk%',
  'Source rejects non http/https URL'
);

-- 10. Invalid source_type rejected
select throws_like(
  $$insert into public.sources (title, source_type, url, created_by)
    values ('URL quá dài', 'website', 'https://example.com/' || repeat('a', 2049), 'a0000000-0000-4000-8000-000000000001')$$,
  '%sources_url_length_chk%',
  'Source rejects URL above length limit'
);

-- 11. Overlong source title rejected
select throws_like(
  $$insert into public.sources (title, source_type, created_by)
    values (repeat('a', 201), 'document', 'a0000000-0000-4000-8000-000000000001')$$,
  '%sources_title_chk%',
  'Source rejects title above length limit'
);

-- 12. Invalid source_type rejected
select throws_like(
  $$insert into public.sources (title, source_type, created_by)
    values ('Invalid type', 'not_real', 'a0000000-0000-4000-8000-000000000001')$$,
  '%sources_source_type_chk%',
  'Source rejects invalid source_type enum'
);

-- 13. Invalid confidence rejected
select throws_like(
  $$insert into public.person_citations (person_id, source_id, field_name, confidence, created_by)
    values ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000001', 'note', 'guess', 'a0000000-0000-4000-8000-000000000001')$$,
  '%person_citations_confidence_chk%',
  'Citation rejects invalid confidence enum'
);

-- 14. Invalid field_name rejected
select throws_like(
  $$insert into public.person_citations (person_id, source_id, field_name, confidence, created_by)
    values ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000001', 'unknown_field', 'primary', 'a0000000-0000-4000-8000-000000000001')$$,
  '%person_citations_field_name_chk%',
  'Citation rejects unlisted field_name'
);

-- 15. Overlong quotation rejected
select throws_like(
  $$insert into public.person_citations (person_id, source_id, field_name, quotation, confidence, created_by)
    values ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000001', 'note', repeat('a', 5001), 'primary', 'a0000000-0000-4000-8000-000000000001')$$,
  '%person_citations_quotation_length_chk%',
  'Citation rejects quotation above length limit'
);

-- 16. Editor can update source
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$update public.sources set title = 'Gia phả họ Trần (bản in lại 1930)' where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  'Editor can update source'
);

-- 17. Editor cannot change created_by
select throws_like(
  $$update public.sources set created_by = 'e0000000-0000-4000-8000-000000000002' where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '%Sources created_by cannot be modified%',
  'Editor cannot transfer created_by on sources'
);

-- 18. Member cannot update source
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000003', true);
select results_eq(
  $$with updated as (update public.sources set title = 'Member sửa' where id = 'aaaaaaaa-0000-4000-8000-000000000001' returning 1) select count(*)::int from updated$$,
  $$values (0)$$,
  'Member cannot update source'
);

-- 19. Member cannot update citation
select results_eq(
  $$with updated as (update public.person_citations set page_reference = 'Member sửa' where id = 'cccccccc-0000-4000-8000-000000000001' returning 1) select count(*)::int from updated$$,
  $$values (0)$$,
  'Member cannot update citation'
);

-- 20. Member cannot delete citation
select results_eq(
  $$with deleted as (delete from public.person_citations where id = 'cccccccc-0000-4000-8000-000000000001' returning 1) select count(*)::int from deleted$$,
  $$values (0)$$,
  'Member cannot delete citation'
);

-- 21. Member cannot delete source
select results_eq(
  $$with deleted as (delete from public.sources where id = 'aaaaaaaa-0000-4000-8000-000000000001' returning 1) select count(*)::int from deleted$$,
  $$values (0)$$,
  'Member cannot delete source'
);

-- 22. Admin cannot change created_by on sources
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
select throws_like(
  $$update public.sources set created_by = 'e0000000-0000-4000-8000-000000000002' where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '%Sources created_by cannot be modified%',
  'Admin cannot modify created_by on sources'
);

-- 23. Admin cannot change created_by on citations
select throws_like(
  $$update public.person_citations set created_by = 'a0000000-0000-4000-8000-000000000001' where id = 'cccccccc-0000-4000-8000-000000000001'$$,
  '%Person citations created_by cannot be modified%',
  'Admin cannot modify created_by on person citations'
);

-- 24. Editor can update citation
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$update public.person_citations set quotation = 'Trích dẫn được sửa bởi editor' where id = 'cccccccc-0000-4000-8000-000000000001'$$,
  'Editor can update citation'
);

-- 25. Editor can delete citation
select results_eq(
  $$with deleted as (delete from public.person_citations where id = 'cccccccc-0000-4000-8000-000000000001' returning 1) select count(*)::int from deleted$$,
  $$values (1)$$,
  'Editor can delete citation'
);

-- 26. Editor can delete source
insert into public.sources (id, title, source_type, created_by)
values ('aaaaaaaa-0000-4000-8000-000000000002', 'Nguồn tạm của editor', 'other', 'e0000000-0000-4000-8000-000000000002');
select results_eq(
  $$with deleted as (delete from public.sources where id = 'aaaaaaaa-0000-4000-8000-000000000002' returning 1) select count(*)::int from deleted$$,
  $$values (1)$$,
  'Editor can delete source'
);

-- 27. Deleted source references cannot be cited
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
select throws_like(
  $$insert into public.person_citations (person_id, source_id, confidence, created_by)
    values ('11111111-1111-4111-8111-111111111111', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'uncertain', 'a0000000-0000-4000-8000-000000000001')$$,
  '%foreign key constraint%',
  'Deleted or missing source references are rejected'
);

-- 28. Cascade on person delete removes citation
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
insert into public.person_citations (id, person_id, source_id, field_name, confidence, created_by)
values ('cccccccc-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000001', 'note', 'uncertain', 'a0000000-0000-4000-8000-000000000001');
delete from public.persons where id = '11111111-1111-4111-8111-111111111111';
select results_eq(
  $$select count(*)::int from public.person_citations where id = 'cccccccc-0000-4000-8000-000000000003'$$,
  $$values (0)$$,
  'Deleting person cascades and removes citation'
);

-- 29. Cascade on source delete removes citation
reset role;
insert into public.persons (id, full_name, gender) values ('11111111-1111-4111-8111-111111111111', 'Trần Văn Tổ 2', 'male');
insert into public.person_citations (id, person_id, source_id, field_name, confidence, created_by)
values ('cccccccc-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000001', 'death_date', 'secondary', 'a0000000-0000-4000-8000-000000000001');
delete from public.sources where id = 'aaaaaaaa-0000-4000-8000-000000000001';
select results_eq(
  $$select count(*)::int from public.person_citations where id = 'cccccccc-0000-4000-8000-000000000002'$$,
  $$values (0)$$,
  'Deleting source cascades and removes citation'
);

select * from finish();
rollback;
