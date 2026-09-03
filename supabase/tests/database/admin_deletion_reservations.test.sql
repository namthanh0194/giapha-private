begin;
select plan(7);

select has_function(
  'public',
  'reserve_admin_user_deletion',
  array['uuid'],
  'Admin deletion reservation function exists'
);
select has_function(
  'public',
  'restore_admin_user_deletion_reservation',
  array['uuid', 'boolean'],
  'Admin deletion reservation restore function exists'
);

update public.profiles
set is_active = false
where role = 'admin'
  and id not in (
    'a0000000-0000-4000-8000-000000000010',
    'a0000000-0000-4000-8000-000000000020'
  );

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000010', 'authenticated', 'authenticated', 'admin-one@example.test', '{}', '{}', now(), now()),
  ('a0000000-0000-4000-8000-000000000020', 'authenticated', 'authenticated', 'admin-two@example.test', '{}', '{}', now(), now());

update public.profiles
set role = 'admin', is_active = true
where id in (
  'a0000000-0000-4000-8000-000000000010',
  'a0000000-0000-4000-8000-000000000020'
);

set local role service_role;

select results_eq(
  $$
    select role::text, previous_is_active
    from public.reserve_admin_user_deletion('a0000000-0000-4000-8000-000000000020')
  $$,
  $$values ('admin'::text, true)$$,
  'First active administrator deletion is reserved'
);
select results_eq(
  $$select is_active from public.profiles where id = 'a0000000-0000-4000-8000-000000000020'$$,
  $$values (false)$$,
  'Reserved administrator is marked inactive'
);
select throws_like(
  $$select * from public.reserve_admin_user_deletion('a0000000-0000-4000-8000-000000000010')$$,
  '%last active administrator%',
  'Concurrent reservation cannot remove the last active administrator'
);
select lives_ok(
  $$select public.restore_admin_user_deletion_reservation('a0000000-0000-4000-8000-000000000020', true)$$,
  'Failed Auth deletion can restore the reservation'
);
select results_eq(
  $$select count(*)::int from public.profiles where role = 'admin' and is_active$$,
  $$values (2)$$,
  'Reservation rollback restores both active administrators'
);

select * from finish();
rollback;
