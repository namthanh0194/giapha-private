begin;
select plan(14);

delete from public.profiles where id in ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003');
delete from auth.users where id in ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003');

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin-backup@example.test', '{}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'member-backup@example.test', '{}', '{}', now(), now());

insert into public.profiles (id, role, is_active)
values
  ('a0000000-0000-4000-8000-000000000001', 'admin', true),
  ('b0000000-0000-4000-8000-000000000003', 'member', true)
on conflict (id) do update
set role = excluded.role, is_active = excluded.is_active;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000003', true);

select throws_like(
  $$
    select public.restore_backup(
      jsonb_build_object(
        'version', 3,
        'persons', jsonb_build_array(
          jsonb_build_object('id', '11111111-1111-4111-8111-111111111111', 'full_name', 'Nguyễn Văn A', 'gender', 'male')
        ),
        'relationships', '[]'::jsonb
      )
    );
  $$,
  '%Access denied. Only administrators can restore backups.%',
  'Non-admin user cannot execute restore_backup'
);

select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);

select is(
  public.restore_backup(
    jsonb_build_object(
      'version', 3,
      'persons', jsonb_build_array(
        jsonb_build_object('id', '11111111-1111-4111-8111-111111111111', 'full_name', 'Nguyễn Văn A', 'gender', 'male'),
        jsonb_build_object('id', '22222222-2222-4222-8222-222222222222', 'full_name', 'Trần Thị B', 'gender', 'female')
      ),
      'relationships', jsonb_build_array(
        jsonb_build_object('id', '33333333-3333-4333-8333-333333333333', 'type', 'marriage', 'person_a', '11111111-1111-4111-8111-111111111111', 'person_b', '22222222-2222-4222-8222-222222222222')
      )
    )
  ),
  jsonb_build_object('persons', 2, 'relationships', 1, 'person_details_private', 0, 'custom_events', 0),
  'Admin restores version 3 payload atomically'
);

select results_eq(
  $$select full_name from public.persons order by full_name$$,
  $$values ('Nguyễn Văn A'::text), ('Trần Thị B'::text)$$,
  'Restored persons exist in database'
);

select results_eq(
  $$select count(*)::int from public.relationships$$,
  $$values (1)$$,
  'Restored relationships exist in database'
);

select throws_like(
  $$
    select public.restore_backup(
      jsonb_build_object(
        'version', 3,
        'persons', jsonb_build_array(
          jsonb_build_object('id', '11111111-1111-4111-8111-111111111111', 'full_name', '', 'gender', 'male')
        ),
        'relationships', '[]'::jsonb
      )
    );
  $$,
  '%Invalid person in backup payload%',
  'Invalid person name rejects restore'
);

select results_eq(
  $$select count(*)::int from public.persons$$,
  $$values (2)$$,
  'Existing persons remain intact after failed restore attempt'
);

select is(
  public.restore_backup(
    jsonb_build_object(
      'version', 4,
      'persons', jsonb_build_array(
        jsonb_build_object('id', '11111111-1111-4111-8111-111111111111', 'full_name', 'Nguyễn Cụ', 'gender', 'male')
      ),
      'relationships', '[]'::jsonb,
      'sources', jsonb_build_array(
        jsonb_build_object('id', 'aaaaaaaa-0000-4000-8000-000000000001', 'title', 'Gia phả bản gốc', 'source_type', 'document')
      ),
      'person_citations', jsonb_build_array(
        jsonb_build_object('id', 'cccccccc-0000-4000-8000-000000000001', 'person_id', '11111111-1111-4111-8111-111111111111', 'source_id', 'aaaaaaaa-0000-4000-8000-000000000001', 'field_name', 'birth_date', 'confidence', 'primary')
      )
    )
  ),
  jsonb_build_object('persons', 1, 'relationships', 0, 'person_details_private', 0, 'custom_events', 0, 'sources', 1, 'person_citations', 1),
  'Version 4 restore returns source and citation counts'
);
select results_eq(
  $$select title from public.sources where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  $$values ('Gia phả bản gốc'::text)$$,
  'Version 4 restore includes sources'
);
select results_eq(
  $$select person_id, source_id from public.person_citations where id = 'cccccccc-0000-4000-8000-000000000001'$$,
  $$values ('11111111-1111-4111-8111-111111111111'::uuid, 'aaaaaaaa-0000-4000-8000-000000000001'::uuid)$$,
  'Version 4 restore links citation to restored person and source'
);

select throws_like(
  $$select public.restore_backup(jsonb_build_object(
    'version', 4,
    'persons', jsonb_build_array(jsonb_build_object('id', '22222222-2222-4222-8222-222222222222', 'full_name', 'Dữ liệu lỗi', 'gender', 'female')),
    'relationships', '[]'::jsonb,
    'sources', jsonb_build_array(jsonb_build_object('id', 'bbbbbbbb-0000-4000-8000-000000000001', 'title', 'Nguồn lỗi', 'source_type', 'other')),
    'person_citations', jsonb_build_array(jsonb_build_object('id', 'dddddddd-0000-4000-8000-000000000001', 'person_id', '22222222-2222-4222-8222-222222222222', 'source_id', 'ffffffff-0000-4000-8000-000000000001', 'confidence', 'uncertain'))
  ))$$,
  '%Invalid person citation in backup payload%',
  'Invalid version 4 citation rejects restore'
);

select is(
  public.restore_backup(
    jsonb_build_object(
      'version', 5,
      'persons', jsonb_build_array(
        jsonb_build_object('id', '11111111-1111-4111-8111-111111111111', 'full_name', 'Cụ Tổ', 'gender', 'male', 'privacy_level', 'family')
      ),
      'relationships', '[]'::jsonb,
      'gallery_items', jsonb_build_array(
        jsonb_build_object('id', '99999999-9999-4999-8999-999999999999', 'title', 'Ảnh chân dung Cụ Tổ', 'image_url', 'cu-to.webp', 'event_date', '1900-01-01', 'person_id', '11111111-1111-4111-8111-111111111111')
      )
    )
  ),
  jsonb_build_object('persons', 1, 'relationships', 0, 'person_details_private', 0, 'custom_events', 0, 'sources', 0, 'person_citations', 0, 'gallery_items', 1),
  'Version 5 restore returns gallery items count'
);

select results_eq(
  $$select title, person_id from public.gallery_items where id = '99999999-9999-4999-8999-999999999999'$$,
  $$values ('Ảnh chân dung Cụ Tổ'::text, '11111111-1111-4111-8111-111111111111'::uuid)$$,
  'Version 5 restore saves gallery item metadata and person linkage'
);

select throws_like(
  $$select public.restore_backup(jsonb_build_object(
    'version', 5,
    'persons', jsonb_build_array(jsonb_build_object('id', '11111111-1111-4111-8111-111111111111', 'full_name', 'Cụ Tổ', 'gender', 'male')),
    'relationships', '[]'::jsonb,
    'gallery_items', jsonb_build_array(jsonb_build_object('id', '88888888-8888-4888-8888-888888888888', 'title', 'Ảnh lỗi FK', 'image_url', 'fail.webp', 'person_id', '77777777-7777-4777-8777-777777777777'))
  ))$$,
  '%Invalid gallery item in backup payload%',
  'Invalid gallery item foreign key person_id rejects restore'
);

select results_eq(
  $$select count(*)::int from public.gallery_items where id = '99999999-9999-4999-8999-999999999999'$$,
  $$values (1)$$,
  'Gallery items remain intact after invalid version 5 restore rollback'
);

select * from finish();
rollback;
