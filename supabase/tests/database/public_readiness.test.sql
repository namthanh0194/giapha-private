BEGIN;
SELECT plan(6);

SELECT has_function('public', 'check_readiness', ARRAY[]::text[], 'Function public.check_readiness() exists');
SELECT function_returns('public', 'check_readiness', ARRAY[]::text[], 'boolean', 'public.check_readiness() returns boolean');

SET ROLE anon;
SELECT is(public.check_readiness(), true, 'anon can execute public.check_readiness() and it returns true');

SET ROLE authenticated;
SELECT is(public.check_readiness(), true, 'authenticated can execute public.check_readiness() and it returns true');

SET ROLE postgres;
SELECT function_privs_are(
  'public',
  'check_readiness',
  ARRAY[]::text[],
  'anon',
  ARRAY['EXECUTE'],
  'anon has EXECUTE on check_readiness'
);

SELECT function_privs_are(
  'public',
  'check_readiness',
  ARRAY[]::text[],
  'authenticated',
  ARRAY['EXECUTE'],
  'authenticated has EXECUTE on check_readiness'
);

SELECT * FROM finish();
ROLLBACK;