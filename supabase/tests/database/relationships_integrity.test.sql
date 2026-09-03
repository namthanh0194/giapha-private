begin;
select plan(8);

insert into public.persons (id, full_name, gender)
values
  ('10000000-0000-4000-8000-000000000001', 'A', 'male'),
  ('20000000-0000-4000-8000-000000000002', 'B', 'female'),
  ('30000000-0000-4000-8000-000000000003', 'C', 'male'),
  ('40000000-0000-4000-8000-000000000004', 'D', 'female'),
  ('50000000-0000-4000-8000-000000000005', 'E', 'male');

select throws_like($$insert into public.relationships (type, person_a, person_b) values ('marriage', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001')$$, '%same person twice%', 'Self relationship is rejected');

insert into public.relationships (type, person_a, person_b) values ('marriage', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002');
select throws_like($$insert into public.relationships (type, person_a, person_b) values ('marriage', '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001')$$, '%', 'Reverse marriage is rejected');

insert into public.relationships (type, person_a, person_b) values ('biological_child', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003');
select throws_like($$insert into public.relationships (type, person_a, person_b) values ('biological_child', '30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001')$$, '%', 'Parent cycle is rejected');

insert into public.relationships (type, person_a, person_b) values ('biological_child', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003');
select throws_like($$insert into public.relationships (type, person_a, person_b) values ('biological_child', '40000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000003')$$, '%more than two biological parents%', 'Third biological parent is rejected');

select throws_like($$insert into public.relationships (type, person_a, person_b) values ('adopted_child', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003')$$, '%', 'Biological and adopted child pair cannot coexist');

-- 6. Marriage between ancestor and descendant is rejected
select throws_like(
  $$insert into public.relationships (type, person_a, person_b) values ('marriage', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003')$$,
  '%ancestor and descendant%',
  'Marriage between parent and child is rejected'
);

-- 7. Valid distinct adoption can be inserted
insert into public.persons (id, full_name, gender) values ('60000000-0000-4000-8000-000000000006', 'F', 'female') on conflict (id) do nothing;
select lives_ok(
  $$insert into public.relationships (type, person_a, person_b) values ('adopted_child', '10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000006')$$,
  'Valid adopted child relationship can be inserted'
);

-- 8. Table constraints presence check
select has_table('public', 'relationships', 'Table relationships exists');

select * from finish();
rollback;
