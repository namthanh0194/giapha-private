begin;
select plan(16);

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('e0000000-0000-4000-8000-000000000401', 'authenticated', 'authenticated', 'editor401@example.test', '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, role, is_active)
values ('e0000000-0000-4000-8000-000000000401', 'editor', true)
on conflict (id) do update set role = excluded.role, is_active = excluded.is_active;

-- Seed rows as postgres; client calls below use the authenticated role.
reset role;
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000401","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000401', true);

insert into public.persons (id, full_name, gender)
values ('41000000-0000-4000-8000-000000000401', 'Phiên bản một', 'male')
on conflict (id) do update set full_name = excluded.full_name;

insert into public.persons (id, full_name, gender)
values ('41000000-0000-4000-8000-000000000402', 'Phiên bản người hai', 'female')
on conflict (id) do update set full_name = excluded.full_name;

insert into public.custom_events (id, name, event_date)
values ('42000000-0000-4000-8000-000000000401', 'Custom event one', '2026-09-01')
on conflict (id) do update set name = excluded.name;

insert into public.relationships (id, type, person_a, person_b)
values (
  '43000000-0000-4000-8000-000000000401',
  'marriage',
  '41000000-0000-4000-8000-000000000401',
  '41000000-0000-4000-8000-000000000402'
)
on conflict (id) do nothing;

select is(
  (select version from public.persons where id = '41000000-0000-4000-8000-000000000401'),
  1,
  'Mutable rows start at version 1'
);

set local role authenticated;

update public.persons set full_name = 'Phiên bản hai' where id = '41000000-0000-4000-8000-000000000401';
update public.persons set full_name = 'Phiên bản ba' where id = '41000000-0000-4000-8000-000000000401';

select is(
  (select version from public.persons where id = '41000000-0000-4000-8000-000000000401'),
  3,
  'Actual updates increment the version'
);

select is(
  public.update_versioned_record(
    'persons',
    '41000000-0000-4000-8000-000000000401',
    3,
    '{"full_name":"Client A"}'::jsonb
  ),
  4,
  'Client A updates version 3 to version 4'
);


select throws_like(
  'select public.update_versioned_record(''persons'', ''41000000-0000-4000-8000-000000000401'', 3, ''{"full_name":"Client B"}''::jsonb)',
  '%Concurrency conflict%',
  'Client B cannot overwrite a stale version 3'
);

select results_eq(
  'select full_name, version from public.persons where id = ''41000000-0000-4000-8000-000000000401''',
  'values (''Client A''::text, 4::integer)',
  'The stale write leaves Client A data unchanged'
);

update public.persons set full_name = full_name where id = '41000000-0000-4000-8000-000000000401';
select is(
  (select version from public.persons where id = '41000000-0000-4000-8000-000000000401'),
  4,
  'No-op updates do not increment the version'
);

select throws_like(
  'update public.persons set version = 99 where id = ''41000000-0000-4000-8000-000000000401''',
  '%Version is managed%',
  'Clients cannot tamper with version'
);

select is(
  public.update_versioned_record(
    'custom_events',
    '42000000-0000-4000-8000-000000000401',
    1,
    '{"name":"Custom event two"}'::jsonb
  ),
  2,
  'Custom event update advances the observed version'
);

select throws_like(
  'select public.update_versioned_record(''custom_events'', ''42000000-0000-4000-8000-000000000401'', 1, ''{"name":"Stale custom event"}''::jsonb)',
  '%Concurrency conflict%',
  'Stale custom event update is rejected'
);

select throws_like(
  'select public.delete_versioned_record(''custom_events'', ''42000000-0000-4000-8000-000000000401'', 1)',
  '%Concurrency conflict%',
  'Stale custom event delete is rejected'
);

select is(
  public.delete_versioned_record(
    'relationships',
    '43000000-0000-4000-8000-000000000401',
    1
  ),
  1,
  'Relationship delete accepts its observed version'
);

select ok((select column_default = '1' from information_schema.columns where table_schema = 'public' and table_name = 'relationships' and column_name = 'version'), 'Relationships have version default');
select ok((select column_default = '1' from information_schema.columns where table_schema = 'public' and table_name = 'custom_events' and column_name = 'version'), 'Custom events have version default');
select ok((select column_default = '1' from information_schema.columns where table_schema = 'public' and table_name = 'gallery_items' and column_name = 'version'), 'Gallery items have version default');
select ok((select column_default = '1' from information_schema.columns where table_schema = 'public' and table_name = 'sources' and column_name = 'version'), 'Sources have version default');
select ok((select column_default = '1' from information_schema.columns where table_schema = 'public' and table_name = 'person_citations' and column_name = 'version'), 'Person citations have version default');

select * from finish();
rollback;
