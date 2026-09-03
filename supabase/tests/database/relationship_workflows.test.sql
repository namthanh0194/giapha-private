begin;
select plan(8);

-- Seed one admin user and initial persons
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin@example.test', '{}', '{}', now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, role, is_active)
values ('a0000000-0000-4000-8000-000000000001', 'admin', true)
on conflict (id) do update set role = 'admin', is_active = true;

insert into public.persons (id, full_name, gender, generation, is_in_law)
values
  ('10000000-0000-4000-8000-000000000001', 'Person A', 'male', 2, false),
  ('20000000-0000-4000-8000-000000000002', 'Person B', 'female', 2, true)
on conflict (id) do nothing;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);

-- 1. create_spouse succeeds and creates both person and marriage
select lives_ok(
  $$
    select public.create_spouse(
      '10000000-0000-4000-8000-000000000001'::uuid,
      jsonb_build_object(
        'full_name', 'Spouse of A',
        'gender', 'female',
        'birth_year', 1985,
        'generation', 2,
        'is_in_law', true
      ),
      'Kết hôn chính thức'
    );
  $$,
  'create_spouse RPC succeeds'
);

-- 2. Persons count is now 3
select results_eq(
  $$select count(*)::int from public.persons$$,
  $$values (3)$$,
  'Person was inserted by create_spouse'
);

-- 3. create_children succeeds for 2 parents and 2 children atomically
select lives_ok(
  $$
    select public.create_children(
      array['10000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-000000000002'::uuid],
      jsonb_build_array(
        jsonb_build_object('full_name', 'Child 1', 'gender', 'male', 'generation', 3, 'birth_order', 1),
        jsonb_build_object('full_name', 'Child 2', 'gender', 'female', 'generation', 3, 'birth_order', 2)
      )
    );
  $$,
  'create_children RPC succeeds'
);

-- 4. Persons count is now 5
select results_eq(
  $$select count(*)::int from public.persons$$,
  $$values (5)$$,
  'Two children inserted by create_children'
);

-- 5. Atomicity test: failure on one child rolls back all inserted children in batch
select throws_like(
  $$
    select public.create_children(
      array['10000000-0000-4000-8000-000000000001'::uuid],
      jsonb_build_array(
        jsonb_build_object('full_name', 'Valid Child', 'gender', 'male'),
        jsonb_build_object('full_name', '', 'gender', 'female')
      )
    );
  $$,
  '%Invalid child name%',
  'create_children rejects empty child name'
);

-- 6. Verify rollback left persons count at 5
select results_eq(
  $$select count(*)::int from public.persons$$,
  $$values (5)$$,
  'Rollback ensured no orphan child was inserted'
);

-- 7. Atomicity test: failure on create_spouse rolls back spouse person record
select throws_like(
  $$
    select public.create_spouse(
      '10000000-0000-4000-8000-000000000001'::uuid,
      jsonb_build_object(
        'full_name', '',
        'gender', 'female'
      ),
      'Invalid spouse name'
    );
  $$,
  '%Invalid spouse name%',
  'create_spouse rejects empty spouse name'
);

-- 8. Verify rollback left persons count unchanged at 5
select results_eq(
  $$select count(*)::int from public.persons$$,
  $$values (5)$$,
  'Rollback ensured no orphan spouse was inserted'
);

select * from finish();
rollback;
