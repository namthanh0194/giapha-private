drop policy if exists "Active users can insert custom events" on public.custom_events;
drop policy if exists "Active users can update own custom events" on public.custom_events;
drop policy if exists "Active users can delete own custom events" on public.custom_events;
create policy "Admins and Editors can insert custom events" on public.custom_events for insert to authenticated with check ((public.is_admin() or public.is_editor()) and auth.uid() = created_by);
create policy "Admins and Editors can update custom events" on public.custom_events for update to authenticated using (public.is_admin() or public.is_editor()) with check (public.is_admin() or public.is_editor());
create policy "Admins and Editors can delete custom events" on public.custom_events for delete to authenticated using (public.is_admin() or public.is_editor());

create or replace function public.prevent_custom_event_owner_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is distinct from old.created_by and not public.is_admin() then
    raise exception 'Only administrators can change an event owner.';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_custom_event_owner_change_trigger on public.custom_events;
create trigger prevent_custom_event_owner_change_trigger
before update of created_by on public.custom_events
for each row execute function public.prevent_custom_event_owner_change();
