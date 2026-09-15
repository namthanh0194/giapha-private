do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.get_family_subtree(uuid, integer, boolean)'::regprocedure
  )
  into function_definition;

  function_definition := replace(
    function_definition,
    'max_depth not between 1 and 10',
    'max_depth not between 1 and 20'
  );
  function_definition := replace(
    function_definition,
    'max_depth must be between 1 and 10',
    'max_depth must be between 1 and 20'
  );

  execute function_definition;
end;
$$;
