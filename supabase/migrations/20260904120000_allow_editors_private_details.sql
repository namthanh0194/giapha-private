-- Allow Admins and Editors to view and manage private details for people they can view
drop policy if exists "Admins can manage private details" on public.person_details_private;
drop policy if exists "Admins can view private details" on public.person_details_private;

create policy "Admins and Editors can view private details"
  on public.person_details_private
  for select
  to authenticated
  using (
    (is_admin() or is_editor())
    and can_view_person(person_id)
  );

create policy "Admins and Editors can manage private details"
  on public.person_details_private
  for all
  to authenticated
  using (
    (is_admin() or is_editor())
    and can_view_person(person_id)
  )
  with check (
    (is_admin() or is_editor())
    and can_view_person(person_id)
  );