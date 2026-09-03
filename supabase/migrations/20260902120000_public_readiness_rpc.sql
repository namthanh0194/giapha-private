-- Public readiness check RPC for lightweight health/readiness probes

create or replace function public.check_readiness()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select true;
$$;

revoke all on function public.check_readiness() from public;
grant execute on function public.check_readiness() to anon, authenticated;

notify pgrst, 'reload schema';
