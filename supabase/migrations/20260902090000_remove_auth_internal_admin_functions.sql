-- User creation and deletion now use the official Supabase Auth Admin API.
-- Keep role and active-status RPCs because they only update public.profiles.
DROP FUNCTION IF EXISTS public.admin_create_user(text, text, text, boolean);
DROP FUNCTION IF EXISTS public.delete_user(uuid);
