begin;
select plan(15);

select throws_like($$insert into public.persons (full_name, gender) values ('', 'male')$$, '%persons_full_name_valid%', 'Empty person name is rejected');
select throws_like($$insert into public.persons (full_name, gender) values (repeat('a', 201), 'male')$$, '%persons_full_name_valid%', 'Oversized person name is rejected');
select throws_like($$insert into public.persons (full_name, gender, birth_month) values ('A', 'male', 13)$$, '%persons_birth_month_valid%', 'Invalid birth month is rejected');
select throws_like($$insert into public.persons (full_name, gender, birth_day) values ('A', 'male', 32)$$, '%persons_birth_day_valid%', 'Invalid birth day is rejected');
select throws_like($$insert into public.persons (full_name, gender, generation) values ('A', 'male', 0)$$, '%persons_generation_valid%', 'Non-positive generation is rejected');
select throws_like($$insert into public.persons (full_name, gender, birth_year, death_year) values ('A', 'male', 2000, 1999)$$, '%persons_death_after_birth%', 'Death before birth is rejected');

insert into public.persons (id, full_name, gender) values
  ('10000000-0000-4000-8000-000000000001', 'A', 'male'),
  ('20000000-0000-4000-8000-000000000002', 'B', 'female');
select throws_like($$insert into public.person_details_private (person_id, phone_number) values ('10000000-0000-4000-8000-000000000001', repeat('1', 501))$$, '%private_phone_length%', 'Oversized phone number is rejected');
select throws_like($$insert into public.relationships (type, person_a, person_b, note) values ('marriage', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', repeat('n', 2001))$$, '%relationships_note_length%', 'Oversized relationship note is rejected');
select throws_like($$insert into public.custom_events (name, event_date) values ('', current_date)$$, '%custom_events_name_valid%', 'Empty event name is rejected');
select throws_like($$insert into public.custom_events (name, event_date, content) values ('E', current_date, repeat('c', 2001))$$, '%custom_events_content_length%', 'Oversized event content is rejected');
select throws_like($$insert into public.gallery_items (title, image_url, description) values ('', 'x', 'd')$$, '%gallery_items_title_valid%', 'Empty gallery title is rejected');
select throws_like($$insert into public.person_details_private (person_id, occupation) values ('10000000-0000-4000-8000-000000000001', repeat('o', 501))$$, '%private_phone_length%', 'Oversized occupation is rejected');
select throws_like($$insert into public.person_details_private (person_id, current_residence) values ('10000000-0000-4000-8000-000000000001', repeat('r', 501))$$, '%private_phone_length%', 'Oversized current_residence is rejected');
select throws_like($$insert into public.custom_events (name, event_date, location) values ('Evt', current_date, repeat('l', 2001))$$, '%custom_events_content_length%', 'Oversized event location is rejected');
select throws_like($$insert into public.gallery_items (title, image_url, description) values ('Title', 'x', repeat('g', 2001))$$, '%gallery_items_description_length%', 'Oversized gallery description is rejected');

select * from finish();
rollback;
