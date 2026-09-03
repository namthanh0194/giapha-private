do $$
declare violations integer;
begin
  select count(*) into violations from public.persons where btrim(full_name) = '' or length(full_name) > 200 or (birth_month is not null and birth_month not between 1 and 12) or (birth_day is not null and birth_day not between 1 and 31) or (death_month is not null and death_month not between 1 and 12) or (death_day is not null and death_day not between 1 and 31) or (death_lunar_month is not null and death_lunar_month not between 1 and 12) or (death_lunar_day is not null and death_lunar_day not between 1 and 31) or (generation is not null and generation < 1) or (birth_order is not null and birth_order < 1) or (birth_year is not null and death_year is not null and death_year < birth_year) or length(coalesce(other_names, '')) > 2000 or length(coalesce(avatar_url, '')) > 2000 or length(coalesce(note, '')) > 2000;
  if violations > 0 then raise exception 'Cannot add person constraints: % existing rows violate bounds.', violations; end if;
  select count(*) into violations from public.person_details_private where length(coalesce(phone_number, '')) > 500 or length(coalesce(occupation, '')) > 500 or length(coalesce(current_residence, '')) > 500;
  if violations > 0 then raise exception 'Cannot add private detail constraints: % existing rows violate bounds.', violations; end if;
  select count(*) into violations from public.custom_events where btrim(name) = '' or length(name) > 200 or length(coalesce(content, '')) > 2000 or length(coalesce(location, '')) > 2000;
  if violations > 0 then raise exception 'Cannot add custom event constraints: % existing rows violate bounds.', violations; end if;
  select count(*) into violations from public.gallery_items where btrim(title) = '' or length(title) > 200 or length(coalesce(description, '')) > 2000;
  if violations > 0 then raise exception 'Cannot add gallery constraints: % existing rows violate bounds.', violations; end if;
end $$;

alter table public.persons
  add constraint persons_full_name_valid check (length(btrim(full_name)) between 1 and 200),
  add constraint persons_birth_month_valid check (birth_month is null or birth_month between 1 and 12),
  add constraint persons_birth_day_valid check (birth_day is null or birth_day between 1 and 31),
  add constraint persons_death_month_valid check (death_month is null or death_month between 1 and 12),
  add constraint persons_death_day_valid check (death_day is null or death_day between 1 and 31),
  add constraint persons_death_lunar_month_valid check (death_lunar_month is null or death_lunar_month between 1 and 12),
  add constraint persons_death_lunar_day_valid check (death_lunar_day is null or death_lunar_day between 1 and 31),
  add constraint persons_generation_valid check (generation is null or generation >= 1),
  add constraint persons_birth_order_valid check (birth_order is null or birth_order >= 1),
  add constraint persons_death_after_birth check (birth_year is null or death_year is null or death_year >= birth_year),
  add constraint persons_text_length check (length(coalesce(other_names, '')) <= 2000 and length(coalesce(avatar_url, '')) <= 2000 and length(coalesce(note, '')) <= 2000);
alter table public.person_details_private add constraint private_phone_length check (length(coalesce(phone_number, '')) <= 500 and length(coalesce(occupation, '')) <= 500 and length(coalesce(current_residence, '')) <= 500);
alter table public.relationships add constraint relationships_note_length check (length(coalesce(note, '')) <= 2000);
alter table public.custom_events add constraint custom_events_name_valid check (length(btrim(name)) between 1 and 200), add constraint custom_events_content_length check (length(coalesce(content, '')) <= 2000 and length(coalesce(location, '')) <= 2000);
alter table public.gallery_items add constraint gallery_items_title_valid check (length(btrim(title)) between 1 and 200), add constraint gallery_items_description_length check (length(coalesce(description, '')) <= 2000);
