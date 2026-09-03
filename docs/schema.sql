-- DEPRECATED: Nguồn migration chính thức duy nhất là supabase/migrations/*.sql
-- ==========================================
-- GIAPHA-OS DATABASE SCHEMA
-- ==========================================

-- EXTENSIONS
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- ENUMS
-- Gender types for family members
DO $$ BEGIN
    CREATE TYPE public.gender_enum AS ENUM ('male', 'female', 'other');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Relationship types between family members
DO $$ BEGIN
    CREATE TYPE public.relationship_type_enum AS ENUM ('marriage', 'biological_child', 'adopted_child');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- System user roles
DO $$ BEGIN
    CREATE TYPE public.user_role_enum AS ENUM ('admin', 'editor', 'member');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ==========================================
-- UTILITY FUNCTIONS
-- ==========================================

-- Function to automatically update 'updated_at' timestamps
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ==========================================
-- TABLES (Data Preservation: No DROP TABLE commands)
-- ==========================================

-- PROFILES (Application users linked to Auth)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  role public.user_role_enum DEFAULT 'member' NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- One-time approval links sent to the administrator.
-- The raw token is never stored in the database.
CREATE TABLE IF NOT EXISTS public.user_approval_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  notified_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- PERSONS (Core entity for family tree)
CREATE TABLE IF NOT EXISTS public.persons (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name TEXT NOT NULL,
  gender public.gender_enum NOT NULL,
  
  -- Date components (allows for partial dates where only year is known)
  birth_year INT,
  birth_month INT,
  birth_day INT,
  death_year INT,
  death_month INT,
  death_day INT,
  death_lunar_year INT,
  death_lunar_month INT,
  death_lunar_day INT,
  
  is_deceased BOOLEAN NOT NULL DEFAULT FALSE,
  is_in_law BOOLEAN NOT NULL DEFAULT FALSE,
  birth_order INT,
  generation INT,
  other_names TEXT,
  avatar_url TEXT,
  note TEXT,
  privacy_level TEXT NOT NULL DEFAULT 'family' CHECK (privacy_level IN ('family', 'editors', 'admins')),
  search_normalized TEXT GENERATED ALWAYS AS (regexp_replace(lower(extensions.unaccent(full_name || coalesce(' ' || other_names, ''))), '\s+', ' ', 'g')) STORED,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- PERSON_DETAILS_PRIVATE (Sensitive data with restricted RLS)
CREATE TABLE IF NOT EXISTS public.person_details_private (
  person_id UUID REFERENCES public.persons(id) ON DELETE CASCADE PRIMARY KEY,
  phone_number TEXT,
  occupation TEXT,
  current_residence TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RELATIONSHIPS (Links between persons)
CREATE TABLE IF NOT EXISTS public.relationships (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type public.relationship_type_enum NOT NULL,
  person_a UUID REFERENCES public.persons(id) ON DELETE CASCADE NOT NULL,
  person_b UUID REFERENCES public.persons(id) ON DELETE CASCADE NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Prevent self-relationships
  CONSTRAINT no_self_relationship CHECK (person_a != person_b),
  
  -- Ensure unique relationships between pairs for a specific type
  UNIQUE(person_a, person_b, type)
);

-- CUSTOM_EVENTS (User-created events)
CREATE TABLE IF NOT EXISTS public.custom_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  content TEXT,
  event_date DATE NOT NULL,
  location TEXT,
  created_by UUID REFERENCES public.profiles(id) DEFAULT auth.uid(),
  person_id UUID REFERENCES public.persons(id) ON DELETE SET NULL,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- INDEXES
-- ==========================================

-- Relationship lookups
CREATE INDEX IF NOT EXISTS idx_relationships_person_a ON public.relationships(person_a);
CREATE INDEX IF NOT EXISTS idx_relationships_person_b ON public.relationships(person_b);
CREATE INDEX IF NOT EXISTS idx_relationships_type ON public.relationships(type);

-- Person filtering and sorting
CREATE INDEX IF NOT EXISTS idx_persons_full_name ON public.persons(full_name);
CREATE INDEX IF NOT EXISTS idx_persons_generation ON public.persons(generation);
CREATE INDEX IF NOT EXISTS idx_persons_gender ON public.persons(gender);
CREATE INDEX IF NOT EXISTS idx_persons_is_deceased ON public.persons(is_deceased);
CREATE INDEX IF NOT EXISTS idx_persons_birth_year ON public.persons(birth_year);
CREATE INDEX IF NOT EXISTS idx_persons_privacy_level ON public.persons(privacy_level);

-- Profile lookups
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_is_active ON public.profiles(is_active);

CREATE INDEX IF NOT EXISTS idx_user_approval_requests_expires_at
  ON public.user_approval_requests(expires_at);

-- Custom events lookups
CREATE INDEX IF NOT EXISTS idx_custom_events_date ON public.custom_events(event_date);
CREATE INDEX IF NOT EXISTS idx_custom_events_created_by ON public.custom_events(created_by);

-- ==========================================
-- RLS POLICIES
-- ==========================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_details_private ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationships ENABLE ROW LEVEL SECURITY;

-- Helper function to check if user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  );
$$;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- Helper function to check if the current user has been approved.
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid() AND is_active = true
  );
$$;
REVOKE ALL ON FUNCTION public.is_active_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated;

-- Helper function to check if user is editor
CREATE OR REPLACE FUNCTION PUBLIC.IS_EDITOR()
RETURNS BOOLEAN
LANGUAGE PLPGSQL
SECURITY DEFINER
SET SEARCH_PATH = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'editor' AND is_active = true
  );
END;
$$;
revoke all on function public.is_editor() from public;
grant execute on function public.is_editor() to authenticated;

CREATE OR REPLACE FUNCTION public.can_view_person(target_person_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles requester
    WHERE requester.id = auth.uid()
      AND requester.is_active
      AND (
        requester.role = 'admin'
        OR EXISTS (
          SELECT 1
          FROM public.persons person
          WHERE person.id = target_person_id
            AND (
              (requester.role = 'editor' AND person.privacy_level IN ('family', 'editors'))
              OR (requester.role = 'member' AND person.privacy_level = 'family')
            )
        )
      )
  );
$$;
REVOKE ALL ON FUNCTION public.can_view_person(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_person(UUID) TO authenticated;

-- PROFILES POLICIES
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT USING (public.is_admin());

-- PERSONS POLICIES
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.persons;
DROP POLICY IF EXISTS "Active users can view persons" ON public.persons;
CREATE POLICY "Active users can view persons" ON public.persons FOR SELECT TO authenticated USING (public.can_view_person(id));

DROP POLICY IF EXISTS "Admins can manage persons" ON public.persons;
DROP POLICY IF EXISTS "Admins can insert persons" ON public.persons;
DROP POLICY IF EXISTS "Admins can update persons" ON public.persons;
DROP POLICY IF EXISTS "Admins can delete persons" ON public.persons;
DROP POLICY IF EXISTS "Admins and Editors can insert persons" ON public.persons;
DROP POLICY IF EXISTS "Admins and Editors can update persons" ON public.persons;
DROP POLICY IF EXISTS "Admins and Editors can delete persons" ON public.persons;

CREATE POLICY "Admins and Editors can insert persons" ON public.persons FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_editor());
CREATE POLICY "Admins and Editors can update persons" ON public.persons FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_editor()) WITH CHECK (public.is_admin() OR public.is_editor());
CREATE POLICY "Admins and Editors can delete persons" ON public.persons FOR DELETE TO authenticated USING (public.is_admin() OR public.is_editor());

-- PERSON_DETAILS_PRIVATE POLICIES
DROP POLICY IF EXISTS "Admins can view private details" ON public.person_details_private;
CREATE POLICY "Admins can view private details" ON public.person_details_private FOR SELECT TO authenticated USING (public.is_admin() AND public.can_view_person(person_id));

DROP POLICY IF EXISTS "Admins can manage private details" ON public.person_details_private;
CREATE POLICY "Admins can manage private details" ON public.person_details_private FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- RELATIONSHIPS POLICIES
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.relationships;
DROP POLICY IF EXISTS "Active users can view relationships" ON public.relationships;
CREATE POLICY "Active users can view relationships" ON public.relationships FOR SELECT TO authenticated USING (public.can_view_person(person_a) AND public.can_view_person(person_b));

DROP POLICY IF EXISTS "Admins can manage relationships" ON public.relationships;
DROP POLICY IF EXISTS "Admins can insert relationships" ON public.relationships;
DROP POLICY IF EXISTS "Admins can update relationships" ON public.relationships;
DROP POLICY IF EXISTS "Admins can delete relationships" ON public.relationships;
DROP POLICY IF EXISTS "Admins and Editors can insert relationships" ON public.relationships;
DROP POLICY IF EXISTS "Admins and Editors can update relationships" ON public.relationships;
DROP POLICY IF EXISTS "Admins and Editors can delete relationships" ON public.relationships;

CREATE POLICY "Admins and Editors can insert relationships" ON public.relationships FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_editor());
CREATE POLICY "Admins and Editors can update relationships" ON public.relationships FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_editor()) WITH CHECK (public.is_admin() OR public.is_editor());
CREATE POLICY "Admins and Editors can delete relationships" ON public.relationships FOR DELETE TO authenticated USING (public.is_admin() OR public.is_editor());

-- CUSTOM_EVENTS POLICIES
ALTER TABLE public.custom_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.custom_events;
DROP POLICY IF EXISTS "Active users can view custom events" ON public.custom_events;
CREATE POLICY "Active users can view custom events" ON public.custom_events FOR SELECT TO authenticated USING (public.is_active_user() AND (person_id IS NULL OR public.can_view_person(person_id)));

DROP POLICY IF EXISTS "Authenticated users can insert custom events" ON public.custom_events;
DROP POLICY IF EXISTS "Active users can insert custom events" ON public.custom_events;
CREATE POLICY "Active users can insert custom events" ON public.custom_events FOR INSERT TO authenticated WITH CHECK (public.is_active_user() AND auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can update own custom events" ON public.custom_events;
DROP POLICY IF EXISTS "Active users can update own custom events" ON public.custom_events;
CREATE POLICY "Active users can update own custom events" ON public.custom_events FOR UPDATE TO authenticated USING (public.is_active_user() AND (auth.uid() = created_by OR public.is_admin())) WITH CHECK (public.is_active_user() AND (auth.uid() = created_by OR public.is_admin()));

DROP POLICY IF EXISTS "Users can delete own custom events" ON public.custom_events;
DROP POLICY IF EXISTS "Active users can delete own custom events" ON public.custom_events;
CREATE POLICY "Active users can delete own custom events" ON public.custom_events FOR DELETE TO authenticated USING (public.is_active_user() AND (auth.uid() = created_by OR public.is_admin()));

-- ==========================================
-- TRIGGERS
-- ==========================================

-- 1. Updated At Triggers
DROP TRIGGER IF EXISTS tr_profiles_updated_at ON public.profiles;
CREATE TRIGGER tr_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_persons_updated_at ON public.persons;
CREATE TRIGGER tr_persons_updated_at BEFORE UPDATE ON public.persons FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_person_details_private_updated_at ON public.person_details_private;
CREATE TRIGGER tr_person_details_private_updated_at BEFORE UPDATE ON public.person_details_private FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_relationships_updated_at ON public.relationships;
CREATE TRIGGER tr_relationships_updated_at BEFORE UPDATE ON public.relationships FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_custom_events_updated_at ON public.custom_events;
CREATE TRIGGER tr_custom_events_updated_at BEFORE UPDATE ON public.custom_events FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- 2. Handle new user signup (Profile creation)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger 
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
  is_first_user boolean;
BEGIN
  -- Serialize bootstrap so concurrent signups cannot create two administrators.
  PERFORM pg_advisory_xact_lock(hashtext('giapha_os_first_user'));
  SELECT NOT EXISTS (SELECT 1 FROM auth.users WHERE id <> NEW.id) INTO is_first_user;

  INSERT INTO public.profiles (id, role, is_active)
  VALUES (
    new.id, 
    CASE WHEN is_first_user THEN 'admin'::public.user_role_enum ELSE 'member'::public.user_role_enum END,
    CASE WHEN is_first_user THEN true ELSE false END
  );

  RETURN new;
END;
$$;

-- 3. Auto-confirm first user (Email verification)
CREATE OR REPLACE FUNCTION public.handle_first_user_confirmation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = auth
AS $$
BEGIN
  -- Serialize bootstrap so concurrent signups cannot create two administrators.
  PERFORM pg_advisory_xact_lock(hashtext('giapha_os_first_user'));
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id <> NEW.id) THEN
    NEW.email_confirmed_at := NOW();
    NEW.last_sign_in_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger for profile creation
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Trigger for auto-confirmation
DROP TRIGGER IF EXISTS on_auth_user_created_confirm ON auth.users;
CREATE TRIGGER on_auth_user_created_confirm
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_first_user_confirmation();

-- ==========================================
-- STORAGE POLICIES
-- ==========================================

-- Initialize 'avatars' bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars', 'avatars', false, 2097152,
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']::text[];

DROP POLICY IF EXISTS "Avatar images are publicly accessible." ON storage.objects;
DROP POLICY IF EXISTS "Active users can view avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view visible avatars" ON storage.objects;
CREATE POLICY "Authenticated users can view visible avatars" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'avatars'
  and exists (
        SELECT 1
        FROM public.persons person
        WHERE public.can_view_person(person.id)
          AND (
            person.avatar_url = name
            OR person.avatar_url LIKE '%/avatars/' || name
            OR (
              name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/'
              AND person.id = split_part(name, '/', 1)::uuid
            )
          )
      )
    )
  );

DROP POLICY IF EXISTS "Users can upload avatars." ON storage.objects;
DROP POLICY IF EXISTS "Admins and editors can upload avatars" ON storage.objects;
CREATE POLICY "Admins and editors can upload avatars" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars' AND (public.is_admin() OR public.is_editor()));

DROP POLICY IF EXISTS "Users can update avatars." ON storage.objects;
DROP POLICY IF EXISTS "Admins and editors can update avatars" ON storage.objects;
CREATE POLICY "Admins and editors can update avatars" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'avatars' AND (public.is_admin() OR public.is_editor()))
  WITH CHECK (bucket_id = 'avatars' AND (public.is_admin() OR public.is_editor()));

DROP POLICY IF EXISTS "Users can delete avatars." ON storage.objects;
DROP POLICY IF EXISTS "Admins and editors can delete avatars" ON storage.objects;
CREATE POLICY "Admins and editors can delete avatars" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'avatars' AND (public.is_admin() OR public.is_editor()));

-- ==========================================
-- ADMIN RPC FUNCTIONS
-- ==========================================

-- Custom type for get_admin_users
DROP TYPE IF EXISTS public.admin_user_data CASCADE;
CREATE TYPE public.admin_user_data AS (
    id uuid,
    email text,
    role public.user_role_enum,
    created_at timestamptz,
    is_active boolean
);

-- 1. Get List of Users for Admin
CREATE OR REPLACE FUNCTION public.get_admin_users()
RETURNS SETOF public.admin_user_data
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access denied.';
    END IF;

    RETURN QUERY
    SELECT au.id, au.email::text, p.role, au.created_at, p.is_active
    FROM auth.users au
    LEFT JOIN public.profiles p ON au.id = p.id
    ORDER BY au.created_at DESC;
END;
$$;

-- 2. Update User Role
CREATE OR REPLACE FUNCTION public.set_user_role(target_user_id uuid, new_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access denied.';
    END IF;

    IF target_user_id = auth.uid() THEN
        RAISE EXCEPTION 'Cannot change your own role.';
    END IF;

    IF new_role::public.user_role_enum <> 'admin'::public.user_role_enum
       AND (SELECT role FROM public.profiles WHERE id = target_user_id) = 'admin'::public.user_role_enum
       AND (SELECT count(*) FROM public.profiles WHERE role = 'admin' AND is_active) <= 1 THEN
        RAISE EXCEPTION 'Cannot remove the last active administrator.';
    END IF;

    UPDATE public.profiles
    SET role = new_role::public.user_role_enum
    WHERE id = target_user_id;
END;
$$;

-- 3. User account creation and deletion use the Supabase Auth Admin API.
-- Role and active-state updates remain in the public schema.

CREATE OR REPLACE FUNCTION public.reserve_admin_user_deletion(target_user_id uuid)
RETURNS TABLE(role public.user_role_enum, previous_is_active boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_role public.user_role_enum;
  target_is_active boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('giapha_os_admin_deletion', 0));

  SELECT profiles.role, profiles.is_active
  INTO target_role, target_is_active
  FROM public.profiles
  WHERE profiles.id = target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF target_role = 'admin'::public.user_role_enum AND target_is_active THEN
    IF (
      SELECT count(*)
      FROM public.profiles
      WHERE profiles.role = 'admin'::public.user_role_enum
        AND profiles.is_active
    ) <= 1 THEN
      RAISE EXCEPTION 'Cannot remove the last active administrator.';
    END IF;

    UPDATE public.profiles
    SET is_active = false
    WHERE id = target_user_id
      AND is_active;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Administrator deletion reservation was not acquired.';
    END IF;
  END IF;

  RETURN QUERY SELECT target_role, target_is_active;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_admin_user_deletion_reservation(
  target_user_id uuid,
  restore_is_active boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('giapha_os_admin_deletion', 0));

  UPDATE public.profiles
  SET is_active = restore_is_active
  WHERE id = target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_admin_user_deletion(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.restore_admin_user_deletion_reservation(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_admin_user_deletion(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_admin_user_deletion_reservation(uuid, boolean) TO service_role;

-- 5. Set User Active Status (Approve/Block)
CREATE OR REPLACE FUNCTION public.set_user_active_status(target_user_id uuid, new_status boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access denied.';
    END IF;

    IF target_user_id = auth.uid() THEN
        RAISE EXCEPTION 'Cannot change your own active status.';
    END IF;

    IF new_status = false
       AND (SELECT role FROM public.profiles WHERE id = target_user_id) = 'admin'::public.user_role_enum
       AND (SELECT count(*) FROM public.profiles WHERE role = 'admin' AND is_active) <= 1 THEN
        RAISE EXCEPTION 'Cannot deactivate the last active administrator.';
    END IF;

    UPDATE public.profiles
    SET is_active = new_status
    WHERE id = target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_users() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_user_role(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_user_active_status(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_active_status(uuid, boolean) TO authenticated;

-- ========================================================
-- 9. GALLERY MODULE
-- ========================================================

-- Add gallery table
CREATE TABLE IF NOT EXISTS public.gallery_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  description text,
  image_url text NOT NULL,
  event_date date,
  person_id uuid REFERENCES public.persons(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.gallery_items ENABLE ROW LEVEL SECURITY;

-- Policy: Chỉ tài khoản đã được admin duyệt mới xem được
DROP POLICY IF EXISTS "Enable read access for all users" ON public.gallery_items;
DROP POLICY IF EXISTS "Active users can view gallery" ON public.gallery_items;
CREATE POLICY "Active users can view gallery" ON public.gallery_items FOR SELECT TO authenticated USING (public.is_active_user() AND (person_id IS NULL OR public.can_view_person(person_id)));

-- Policy: chỉ admin quản lý file gallery; member/editor chỉ xem.
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.gallery_items;
DROP POLICY IF EXISTS "Active users can insert gallery" ON public.gallery_items;
DROP POLICY IF EXISTS "Admins can insert gallery" ON public.gallery_items;
CREATE POLICY "Admins can insert gallery" ON public.gallery_items FOR INSERT TO authenticated WITH CHECK (public.is_admin() AND auth.uid() = created_by);

-- Policy: Chỉ admin hoặc người tạo mới được sửa
DROP POLICY IF EXISTS "Enable update for admin and owner" ON public.gallery_items;
DROP POLICY IF EXISTS "Active users can update gallery" ON public.gallery_items;
DROP POLICY IF EXISTS "Admins can update gallery" ON public.gallery_items;
CREATE POLICY "Admins can update gallery" ON public.gallery_items FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Policy: Chỉ admin hoặc người tạo mới được xóa
DROP POLICY IF EXISTS "Enable delete for admin and owner" ON public.gallery_items;
DROP POLICY IF EXISTS "Active users can delete gallery" ON public.gallery_items;
DROP POLICY IF EXISTS "Admins can delete gallery" ON public.gallery_items;
CREATE POLICY "Admins can delete gallery" ON public.gallery_items FOR DELETE TO authenticated USING (public.is_admin());

-- ========================================================
-- 10. STORAGE BUCKETS
-- ========================================================

-- Create storage bucket for gallery
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'gallery', 'gallery', false, 10485760,
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']::text[];

-- Storage policies
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "Active users can view gallery files" ON storage.objects;
DROP POLICY IF EXISTS "Admins can view gallery files" ON storage.objects;
CREATE POLICY "Active users can view gallery files"
ON storage.objects FOR SELECT
TO authenticated
USING ( bucket_id = 'gallery' AND public.is_active_user() );

DROP POLICY IF EXISTS "Authenticated users can upload" ON storage.objects;
DROP POLICY IF EXISTS "Active users can upload gallery files" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload gallery files" ON storage.objects;
CREATE POLICY "Admins can upload gallery files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK ( bucket_id = 'gallery' AND public.is_admin() );

DROP POLICY IF EXISTS "Admin and owner can update" ON storage.objects;
DROP POLICY IF EXISTS "Active users can update gallery files" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update gallery files" ON storage.objects;
CREATE POLICY "Admins can update gallery files"
ON storage.objects FOR UPDATE
TO authenticated
USING ( bucket_id = 'gallery' AND public.is_admin() )
WITH CHECK ( bucket_id = 'gallery' AND public.is_admin() );

DROP POLICY IF EXISTS "Admin and owner can delete" ON storage.objects;
DROP POLICY IF EXISTS "Active users can delete gallery files" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete gallery files" ON storage.objects;
CREATE POLICY "Admins can delete gallery files"
ON storage.objects FOR DELETE
TO authenticated
USING ( bucket_id = 'gallery' AND public.is_admin() );

-- Public readiness check used by application and container probes.
CREATE OR REPLACE FUNCTION public.check_readiness()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT true;
$$;

REVOKE ALL ON FUNCTION public.check_readiness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_readiness() TO anon, authenticated;

-- Transactional restore function.
create or replace function public.restore_backup(import_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  persons_count integer;
  relationships_count integer;
  private_details_count integer;
  events_count integer;
  sources_count integer;
  citations_count integer;
  gallery_items_count integer;
begin
  if not public.is_admin() then
    raise exception 'Access denied. Only administrators can restore backups.';
  end if;

  if import_payload ->> 'version' not in ('3', '4', '5')
    or jsonb_typeof(import_payload -> 'persons') <> 'array'
    or jsonb_typeof(import_payload -> 'relationships') <> 'array'
    or jsonb_typeof(coalesce(import_payload -> 'person_details_private', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(import_payload -> 'custom_events', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(import_payload -> 'sources', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(import_payload -> 'person_citations', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(import_payload -> 'gallery_items', '[]'::jsonb)) <> 'array' then
    raise exception 'Invalid backup payload.';
  end if;

  drop table if exists pg_temp.restore_persons;
  drop table if exists pg_temp.restore_relationships;
  drop table if exists pg_temp.restore_private_details;
  drop table if exists pg_temp.restore_events;
  drop table if exists pg_temp.restore_sources;
  drop table if exists pg_temp.restore_person_citations;
  drop table if exists pg_temp.restore_gallery_items;
  create temporary table restore_persons (payload jsonb not null) on commit drop;
  create temporary table restore_relationships (payload jsonb not null) on commit drop;
  create temporary table restore_private_details (payload jsonb not null) on commit drop;
  create temporary table restore_events (payload jsonb not null) on commit drop;
  create temporary table restore_sources (payload jsonb not null) on commit drop;
  create temporary table restore_person_citations (payload jsonb not null) on commit drop;
  create temporary table restore_gallery_items (payload jsonb not null) on commit drop;
  insert into restore_persons select value from jsonb_array_elements(import_payload -> 'persons');
  insert into restore_relationships select value from jsonb_array_elements(import_payload -> 'relationships');
  insert into restore_private_details select value from jsonb_array_elements(coalesce(import_payload -> 'person_details_private', '[]'::jsonb));
  insert into restore_events select value from jsonb_array_elements(coalesce(import_payload -> 'custom_events', '[]'::jsonb));
  insert into restore_sources select value from jsonb_array_elements(coalesce(import_payload -> 'sources', '[]'::jsonb));
  insert into restore_person_citations select value from jsonb_array_elements(coalesce(import_payload -> 'person_citations', '[]'::jsonb));
  insert into restore_gallery_items select value from jsonb_array_elements(coalesce(import_payload -> 'gallery_items', '[]'::jsonb));

  select count(*) into persons_count from restore_persons;
  select count(*) into relationships_count from restore_relationships;
  select count(*) into private_details_count from restore_private_details;
  select count(*) into events_count from restore_events;
  select count(*) into sources_count from restore_sources;
  select count(*) into citations_count from restore_person_citations;
  select count(*) into gallery_items_count from restore_gallery_items;
  if persons_count = 0 or persons_count > 10000 or relationships_count > 30000 or private_details_count > 10000 or events_count > 10000 or sources_count > 10000 or citations_count > 30000 or gallery_items_count > 10000 then
    raise exception 'Backup payload exceeds allowed limits.';
  end if;

  if exists (
    select 1 from restore_persons
    where coalesce(payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or nullif(btrim(payload ->> 'full_name'), '') is null
      or length(payload ->> 'full_name') > 200
      or payload ->> 'gender' not in ('male', 'female', 'other')
      or coalesce(payload ->> 'privacy_level', 'family') not in ('family', 'editors', 'admins')
  ) or exists (
    select 1 from restore_persons group by payload ->> 'id' having count(*) > 1
  ) then raise exception 'Invalid person in backup payload.'; end if;

  if exists (
    select 1 from restore_relationships r
    where coalesce(r.payload ->> 'type', '') not in ('marriage', 'biological_child', 'adopted_child')
      or coalesce(r.payload ->> 'person_a', '') = coalesce(r.payload ->> 'person_b', '')
      or not exists (select 1 from restore_persons p where p.payload ->> 'id' = r.payload ->> 'person_a')
      or not exists (select 1 from restore_persons p where p.payload ->> 'id' = r.payload ->> 'person_b')
  ) or exists (
    select 1 from restore_relationships group by payload ->> 'type', payload ->> 'person_a', payload ->> 'person_b' having count(*) > 1
  ) or exists (
    select 1 from restore_relationships group by least(payload ->> 'person_a', payload ->> 'person_b'), greatest(payload ->> 'person_a', payload ->> 'person_b')
    having bool_or(payload ->> 'type' = 'biological_child') and bool_or(payload ->> 'type' = 'adopted_child')
  ) or exists (
    select 1 from restore_relationships where payload ->> 'type' = 'biological_child'
    group by payload ->> 'person_b' having count(*) > 2
  ) or exists (
    select 1 from restore_relationships where payload ->> 'type' = 'adopted_child'
    group by payload ->> 'person_b' having count(*) > 2
  ) then raise exception 'Invalid relationship in backup payload.'; end if;

  if exists (
    select 1 from restore_private_details d
    where not exists (select 1 from restore_persons p where p.payload ->> 'id' = d.payload ->> 'person_id')
      or length(coalesce(d.payload ->> 'phone_number', '')) > 30
      or length(coalesce(d.payload ->> 'occupation', '')) > 200
      or length(coalesce(d.payload ->> 'current_residence', '')) > 500
  ) or exists (
    select 1 from restore_private_details group by payload ->> 'person_id' having count(*) > 1
  ) then raise exception 'Invalid private details in backup payload.'; end if;

  if exists (
    select 1 from restore_events e
    where coalesce(e.payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or nullif(btrim(e.payload ->> 'name'), '') is null
      or length(e.payload ->> 'name') > 200
      or length(coalesce(e.payload ->> 'content', '')) > 2000
      or length(coalesce(e.payload ->> 'location', '')) > 300
      or coalesce(e.payload ->> 'event_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or (
        e.payload ->> 'person_id' is not null
        and not exists (
          select 1
          from restore_persons p
          where p.payload ->> 'id' = e.payload ->> 'person_id'
        )
      )
  ) or exists (
    select 1 from restore_events group by payload ->> 'id' having count(*) > 1
  ) then raise exception 'Invalid custom event in backup payload.'; end if;

  if exists (
    select 1 from restore_sources s
    where coalesce(s.payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or nullif(btrim(s.payload ->> 'title'), '') is null or length(s.payload ->> 'title') > 200
      or coalesce(s.payload ->> 'source_type', '') not in ('document', 'book', 'oral_history', 'website', 'photo', 'other')
      or length(coalesce(payload ->> 'author', '')) > 300 or length(coalesce(payload ->> 'publisher', '')) > 300
      or length(coalesce(payload ->> 'url', '')) > 2048 or (payload ->> 'url' is not null and payload ->> 'url' !~* '^https?://[^[:space:]]+$')
      or length(coalesce(payload ->> 'repository', '')) > 500 or length(coalesce(payload ->> 'note', '')) > 5000
  ) or exists (select 1 from restore_sources group by payload ->> 'id' having count(*) > 1) then
    raise exception 'Invalid source in backup payload.';
  end if;

  if exists (
    select 1 from restore_person_citations c
    where coalesce(c.payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or not exists (select 1 from restore_persons p where p.payload ->> 'id' = c.payload ->> 'person_id')
      or not exists (select 1 from restore_sources s where s.payload ->> 'id' = c.payload ->> 'source_id')
      or (c.payload ->> 'field_name' is not null and c.payload ->> 'field_name' not in ('birth_date', 'death_date', 'relationship', 'note', 'other'))
      or length(coalesce(c.payload ->> 'page_reference', '')) > 300 or length(coalesce(c.payload ->> 'quotation', '')) > 5000
      or c.payload ->> 'confidence' not in ('primary', 'secondary', 'uncertain')
  ) or exists (select 1 from restore_person_citations group by payload ->> 'id' having count(*) > 1) then
    raise exception 'Invalid person citation in backup payload.';
  end if;

  if exists (
    select 1 from restore_gallery_items item
    where coalesce(item.payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or nullif(btrim(item.payload ->> 'title'), '') is null
      or length(item.payload ->> 'title') > 200
      or length(coalesce(item.payload ->> 'description', '')) > 2000
      or nullif(btrim(item.payload ->> 'image_url'), '') is null
      or length(item.payload ->> 'image_url') > 2048
      or (item.payload ->> 'event_date' is not null and item.payload ->> 'event_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}
      or (
        item.payload ->> 'person_id' is not null
        and not exists (
          select 1 from restore_persons person
          where person.payload ->> 'id' = item.payload ->> 'person_id'
        )
      )
  ) or exists (
    select 1 from restore_gallery_items group by payload ->> 'id' having count(*) > 1
  ) then
    raise exception 'Invalid gallery item in backup payload.';
  end if;

  delete from public.gallery_items;
  delete from public.person_citations;
  delete from public.sources;
  delete from public.custom_events;
  delete from public.relationships;
  delete from public.person_details_private;
  delete from public.persons;

  insert into public.persons (id, full_name, gender, birth_year, birth_month, birth_day, death_year, death_month, death_day, death_lunar_year, death_lunar_month, death_lunar_day, is_deceased, is_in_law, birth_order, generation, other_names, avatar_url, note, privacy_level)
  select (payload ->> 'id')::uuid, payload ->> 'full_name', (payload ->> 'gender')::public.gender_enum, (payload ->> 'birth_year')::integer, (payload ->> 'birth_month')::integer, (payload ->> 'birth_day')::integer, (payload ->> 'death_year')::integer, (payload ->> 'death_month')::integer, (payload ->> 'death_day')::integer, (payload ->> 'death_lunar_year')::integer, (payload ->> 'death_lunar_month')::integer, (payload ->> 'death_lunar_day')::integer, coalesce((payload ->> 'is_deceased')::boolean, false), coalesce((payload ->> 'is_in_law')::boolean, false), (payload ->> 'birth_order')::integer, (payload ->> 'generation')::integer, payload ->> 'other_names', payload ->> 'avatar_url', payload ->> 'note', coalesce(payload ->> 'privacy_level', 'family') from restore_persons;
  insert into public.person_details_private (person_id, phone_number, occupation, current_residence)
  select (payload ->> 'person_id')::uuid, payload ->> 'phone_number', payload ->> 'occupation', payload ->> 'current_residence' from restore_private_details;
  insert into public.relationships (type, person_a, person_b, note)
  select (payload ->> 'type')::public.relationship_type_enum, (payload ->> 'person_a')::uuid, (payload ->> 'person_b')::uuid, payload ->> 'note' from restore_relationships;
  insert into public.custom_events (id, name, content, event_date, location, created_by, person_id)
  select (payload ->> 'id')::uuid, payload ->> 'name', payload ->> 'content', (payload ->> 'event_date')::date, payload ->> 'location', caller_id, (payload ->> 'person_id')::uuid from restore_events;
  insert into public.sources (id, title, source_type, author, publisher, publication_date, url, repository, note, created_by)
  select (payload ->> 'id')::uuid, payload ->> 'title', payload ->> 'source_type', payload ->> 'author', payload ->> 'publisher', (payload ->> 'publication_date')::date, payload ->> 'url', payload ->> 'repository', payload ->> 'note', caller_id from restore_sources;
  insert into public.person_citations (id, person_id, source_id, field_name, page_reference, quotation, confidence, created_by)
  select (payload ->> 'id')::uuid, (payload ->> 'person_id')::uuid, (payload ->> 'source_id')::uuid, payload ->> 'field_name', payload ->> 'page_reference', payload ->> 'quotation', payload ->> 'confidence', caller_id from restore_person_citations;
  insert into public.gallery_items (id, title, description, image_url, event_date, created_by, person_id)
  select (payload ->> 'id')::uuid, payload ->> 'title', payload ->> 'description', payload ->> 'image_url', (payload ->> 'event_date')::date, caller_id, (payload ->> 'person_id')::uuid from restore_gallery_items;

  if import_payload ->> 'version' = '3' then
    return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count);
  end if;

  if import_payload ->> 'version' = '4' then
    return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count, 'sources', sources_count, 'person_citations', citations_count);
  end if;

  return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count, 'sources', sources_count, 'person_citations', citations_count, 'gallery_items', gallery_items_count);
end;
$$;

revoke all on function public.restore_backup(jsonb) from public, anon;
grant execute on function public.restore_backup(jsonb) to authenticated;

      or (
        e.payload ->> 'person_id' is not null
        and not exists (
          select 1
          from restore_persons p
          where p.payload ->> 'id' = e.payload ->> 'person_id'
        )
      )
  ) or exists (
    select 1 from restore_events group by payload ->> 'id' having count(*) > 1
  ) then raise exception 'Invalid custom event in backup payload.'; end if;

  if exists (
    select 1 from restore_sources s
    where coalesce(s.payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or nullif(btrim(s.payload ->> 'title'), '') is null or length(s.payload ->> 'title') > 200
      or coalesce(s.payload ->> 'source_type', '') not in ('document', 'book', 'oral_history', 'website', 'photo', 'other')
      or length(coalesce(payload ->> 'author', '')) > 300 or length(coalesce(payload ->> 'publisher', '')) > 300
      or length(coalesce(payload ->> 'url', '')) > 2048 or (payload ->> 'url' is not null and payload ->> 'url' !~* '^https?://[^[:space:]]+$')
      or length(coalesce(payload ->> 'repository', '')) > 500 or length(coalesce(payload ->> 'note', '')) > 5000
  ) or exists (select 1 from restore_sources group by payload ->> 'id' having count(*) > 1) then
    raise exception 'Invalid source in backup payload.';
  end if;

  if exists (
    select 1 from restore_person_citations c
    where coalesce(c.payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or not exists (select 1 from restore_persons p where p.payload ->> 'id' = c.payload ->> 'person_id')
      or not exists (select 1 from restore_sources s where s.payload ->> 'id' = c.payload ->> 'source_id')
      or (c.payload ->> 'field_name' is not null and c.payload ->> 'field_name' not in ('birth_date', 'death_date', 'relationship', 'note', 'other'))
      or length(coalesce(c.payload ->> 'page_reference', '')) > 300 or length(coalesce(c.payload ->> 'quotation', '')) > 5000
      or c.payload ->> 'confidence' not in ('primary', 'secondary', 'uncertain')
  ) or exists (select 1 from restore_person_citations group by payload ->> 'id' having count(*) > 1) then
    raise exception 'Invalid person citation in backup payload.';
  end if;

  if exists (
    select 1 from restore_gallery_items item
    where coalesce(item.payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or nullif(btrim(item.payload ->> 'title'), '') is null
      or length(item.payload ->> 'title') > 200
      or length(coalesce(item.payload ->> 'description', '')) > 2000
      or nullif(btrim(item.payload ->> 'image_url'), '') is null
      or length(item.payload ->> 'image_url') > 2048
      or (item.payload ->> 'event_date' is not null and item.payload ->> 'event_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
      or (
        item.payload ->> 'person_id' is not null
        and not exists (
          select 1 from restore_persons person
          where person.payload ->> 'id' = item.payload ->> 'person_id'
        )
      )
  ) or exists (
    select 1 from restore_gallery_items group by payload ->> 'id' having count(*) > 1
  ) then
    raise exception 'Invalid gallery item in backup payload.';
  end if;

  delete from public.gallery_items;
  delete from public.person_citations;
  delete from public.sources;
  delete from public.custom_events;
  delete from public.relationships;
  delete from public.person_details_private;
  delete from public.persons;

  insert into public.persons (id, full_name, gender, birth_year, birth_month, birth_day, death_year, death_month, death_day, death_lunar_year, death_lunar_month, death_lunar_day, is_deceased, is_in_law, birth_order, generation, other_names, avatar_url, note, privacy_level)
  select (payload ->> 'id')::uuid, payload ->> 'full_name', (payload ->> 'gender')::public.gender_enum, (payload ->> 'birth_year')::integer, (payload ->> 'birth_month')::integer, (payload ->> 'birth_day')::integer, (payload ->> 'death_year')::integer, (payload ->> 'death_month')::integer, (payload ->> 'death_day')::integer, (payload ->> 'death_lunar_year')::integer, (payload ->> 'death_lunar_month')::integer, (payload ->> 'death_lunar_day')::integer, coalesce((payload ->> 'is_deceased')::boolean, false), coalesce((payload ->> 'is_in_law')::boolean, false), (payload ->> 'birth_order')::integer, (payload ->> 'generation')::integer, payload ->> 'other_names', payload ->> 'avatar_url', payload ->> 'note', coalesce(payload ->> 'privacy_level', 'family') from restore_persons;
  insert into public.person_details_private (person_id, phone_number, occupation, current_residence)
  select (payload ->> 'person_id')::uuid, payload ->> 'phone_number', payload ->> 'occupation', payload ->> 'current_residence' from restore_private_details;
  insert into public.relationships (type, person_a, person_b, note)
  select (payload ->> 'type')::public.relationship_type_enum, (payload ->> 'person_a')::uuid, (payload ->> 'person_b')::uuid, payload ->> 'note' from restore_relationships;
  insert into public.custom_events (id, name, content, event_date, location, created_by, person_id)
  select (payload ->> 'id')::uuid, payload ->> 'name', payload ->> 'content', (payload ->> 'event_date')::date, payload ->> 'location', caller_id, (payload ->> 'person_id')::uuid from restore_events;
  insert into public.sources (id, title, source_type, author, publisher, publication_date, url, repository, note, created_by)
  select (payload ->> 'id')::uuid, payload ->> 'title', payload ->> 'source_type', payload ->> 'author', payload ->> 'publisher', (payload ->> 'publication_date')::date, payload ->> 'url', payload ->> 'repository', payload ->> 'note', caller_id from restore_sources;
  insert into public.person_citations (id, person_id, source_id, field_name, page_reference, quotation, confidence, created_by)
  select (payload ->> 'id')::uuid, (payload ->> 'person_id')::uuid, (payload ->> 'source_id')::uuid, payload ->> 'field_name', payload ->> 'page_reference', payload ->> 'quotation', payload ->> 'confidence', caller_id from restore_person_citations;
  insert into public.gallery_items (id, title, description, image_url, event_date, created_by, person_id)
  select (payload ->> 'id')::uuid, payload ->> 'title', payload ->> 'description', payload ->> 'image_url', (payload ->> 'event_date')::date, caller_id, (payload ->> 'person_id')::uuid from restore_gallery_items;

  if import_payload ->> 'version' = '3' then
    return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count);
  end if;

  if import_payload ->> 'version' = '4' then
    return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count, 'sources', sources_count, 'person_citations', citations_count);
  end if;

  return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count, 'sources', sources_count, 'person_citations', citations_count, 'gallery_items', gallery_items_count);
end;
$$;

revoke all on function public.restore_backup(jsonb) from public, anon;
grant execute on function public.restore_backup(jsonb) to authenticated;
)
      or (
        item.payload ->> 'person_id' is not null
        and not exists (
          select 1 from restore_persons person
          where person.payload ->> 'id' = item.payload ->> 'person_id'
        )
      )
  ) or exists (
    select 1 from restore_gallery_items group by payload ->> 'id' having count(*) > 1
  ) then
    raise exception 'Invalid gallery item in backup payload.';
  end if;

  delete from public.gallery_items;
  delete from public.person_citations;
  delete from public.sources;
  delete from public.custom_events;
  delete from public.relationships;
  delete from public.person_details_private;
  delete from public.persons;

  insert into public.persons (id, full_name, gender, birth_year, birth_month, birth_day, death_year, death_month, death_day, death_lunar_year, death_lunar_month, death_lunar_day, is_deceased, is_in_law, birth_order, generation, other_names, avatar_url, note, privacy_level)
  select (payload ->> 'id')::uuid, payload ->> 'full_name', (payload ->> 'gender')::public.gender_enum, (payload ->> 'birth_year')::integer, (payload ->> 'birth_month')::integer, (payload ->> 'birth_day')::integer, (payload ->> 'death_year')::integer, (payload ->> 'death_month')::integer, (payload ->> 'death_day')::integer, (payload ->> 'death_lunar_year')::integer, (payload ->> 'death_lunar_month')::integer, (payload ->> 'death_lunar_day')::integer, coalesce((payload ->> 'is_deceased')::boolean, false), coalesce((payload ->> 'is_in_law')::boolean, false), (payload ->> 'birth_order')::integer, (payload ->> 'generation')::integer, payload ->> 'other_names', payload ->> 'avatar_url', payload ->> 'note', coalesce(payload ->> 'privacy_level', 'family') from restore_persons;
  insert into public.person_details_private (person_id, phone_number, occupation, current_residence)
  select (payload ->> 'person_id')::uuid, payload ->> 'phone_number', payload ->> 'occupation', payload ->> 'current_residence' from restore_private_details;
  insert into public.relationships (type, person_a, person_b, note)
  select (payload ->> 'type')::public.relationship_type_enum, (payload ->> 'person_a')::uuid, (payload ->> 'person_b')::uuid, payload ->> 'note' from restore_relationships;
  insert into public.custom_events (id, name, content, event_date, location, created_by, person_id)
  select (payload ->> 'id')::uuid, payload ->> 'name', payload ->> 'content', (payload ->> 'event_date')::date, payload ->> 'location', caller_id, (payload ->> 'person_id')::uuid from restore_events;
  insert into public.sources (id, title, source_type, author, publisher, publication_date, url, repository, note, created_by)
  select (payload ->> 'id')::uuid, payload ->> 'title', payload ->> 'source_type', payload ->> 'author', payload ->> 'publisher', (payload ->> 'publication_date')::date, payload ->> 'url', payload ->> 'repository', payload ->> 'note', caller_id from restore_sources;
  insert into public.person_citations (id, person_id, source_id, field_name, page_reference, quotation, confidence, created_by)
  select (payload ->> 'id')::uuid, (payload ->> 'person_id')::uuid, (payload ->> 'source_id')::uuid, payload ->> 'field_name', payload ->> 'page_reference', payload ->> 'quotation', payload ->> 'confidence', caller_id from restore_person_citations;
  insert into public.gallery_items (id, title, description, image_url, event_date, created_by, person_id)
  select (payload ->> 'id')::uuid, payload ->> 'title', payload ->> 'description', payload ->> 'image_url', (payload ->> 'event_date')::date, caller_id, (payload ->> 'person_id')::uuid from restore_gallery_items;

  if import_payload ->> 'version' = '3' then
    return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count);
  end if;

  if import_payload ->> 'version' = '4' then
    return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count, 'sources', sources_count, 'person_citations', citations_count);
  end if;

  return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count, 'sources', sources_count, 'person_citations', citations_count, 'gallery_items', gallery_items_count);
end;
$$;

revoke all on function public.restore_backup(jsonb) from public, anon;
grant execute on function public.restore_backup(jsonb) to authenticated;

      or (
        e.payload ->> 'person_id' is not null
        and not exists (
          select 1
          from restore_persons p
          where p.payload ->> 'id' = e.payload ->> 'person_id'
        )
      )
  ) or exists (
    select 1 from restore_events group by payload ->> 'id' having count(*) > 1
  ) then raise exception 'Invalid custom event in backup payload.'; end if;

  if exists (
    select 1 from restore_sources s
    where coalesce(s.payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or nullif(btrim(s.payload ->> 'title'), '') is null or length(s.payload ->> 'title') > 200
      or coalesce(s.payload ->> 'source_type', '') not in ('document', 'book', 'oral_history', 'website', 'photo', 'other')
      or length(coalesce(payload ->> 'author', '')) > 300 or length(coalesce(payload ->> 'publisher', '')) > 300
      or length(coalesce(payload ->> 'url', '')) > 2048 or (payload ->> 'url' is not null and payload ->> 'url' !~* '^https?://[^[:space:]]+$')
      or length(coalesce(payload ->> 'repository', '')) > 500 or length(coalesce(payload ->> 'note', '')) > 5000
  ) or exists (select 1 from restore_sources group by payload ->> 'id' having count(*) > 1) then
    raise exception 'Invalid source in backup payload.';
  end if;

  if exists (
    select 1 from restore_person_citations c
    where coalesce(c.payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or not exists (select 1 from restore_persons p where p.payload ->> 'id' = c.payload ->> 'person_id')
      or not exists (select 1 from restore_sources s where s.payload ->> 'id' = c.payload ->> 'source_id')
      or (c.payload ->> 'field_name' is not null and c.payload ->> 'field_name' not in ('birth_date', 'death_date', 'relationship', 'note', 'other'))
      or length(coalesce(c.payload ->> 'page_reference', '')) > 300 or length(coalesce(c.payload ->> 'quotation', '')) > 5000
      or c.payload ->> 'confidence' not in ('primary', 'secondary', 'uncertain')
  ) or exists (select 1 from restore_person_citations group by payload ->> 'id' having count(*) > 1) then
    raise exception 'Invalid person citation in backup payload.';
  end if;

  if exists (
    select 1 from restore_gallery_items item
    where coalesce(item.payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or nullif(btrim(item.payload ->> 'title'), '') is null
      or length(item.payload ->> 'title') > 200
      or length(coalesce(item.payload ->> 'description', '')) > 2000
      or nullif(btrim(item.payload ->> 'image_url'), '') is null
      or length(item.payload ->> 'image_url') > 2048
      or (item.payload ->> 'event_date' is not null and item.payload ->> 'event_date' !~ '^d{4}-d{2}-d{2}$')
      or (
        item.payload ->> 'person_id' is not null
        and not exists (
          select 1 from restore_persons person
          where person.payload ->> 'id' = item.payload ->> 'person_id'
        )
      )
  ) or exists (
    select 1 from restore_gallery_items group by payload ->> 'id' having count(*) > 1
  ) then
    raise exception 'Invalid gallery item in backup payload.';
  end if;

  delete from public.gallery_items;
  delete from public.person_citations;
  delete from public.sources;
  delete from public.custom_events;
  delete from public.relationships;
  delete from public.person_details_private;
  delete from public.persons;

  insert into public.persons (id, full_name, gender, birth_year, birth_month, birth_day, death_year, death_month, death_day, death_lunar_year, death_lunar_month, death_lunar_day, is_deceased, is_in_law, birth_order, generation, other_names, avatar_url, note, privacy_level)
  select (payload ->> 'id')::uuid, payload ->> 'full_name', (payload ->> 'gender')::public.gender_enum, (payload ->> 'birth_year')::integer, (payload ->> 'birth_month')::integer, (payload ->> 'birth_day')::integer, (payload ->> 'death_year')::integer, (payload ->> 'death_month')::integer, (payload ->> 'death_day')::integer, (payload ->> 'death_lunar_year')::integer, (payload ->> 'death_lunar_month')::integer, (payload ->> 'death_lunar_day')::integer, coalesce((payload ->> 'is_deceased')::boolean, false), coalesce((payload ->> 'is_in_law')::boolean, false), (payload ->> 'birth_order')::integer, (payload ->> 'generation')::integer, payload ->> 'other_names', payload ->> 'avatar_url', payload ->> 'note', coalesce(payload ->> 'privacy_level', 'family') from restore_persons;
  insert into public.person_details_private (person_id, phone_number, occupation, current_residence)
  select (payload ->> 'person_id')::uuid, payload ->> 'phone_number', payload ->> 'occupation', payload ->> 'current_residence' from restore_private_details;
  insert into public.relationships (type, person_a, person_b, note)
  select (payload ->> 'type')::public.relationship_type_enum, (payload ->> 'person_a')::uuid, (payload ->> 'person_b')::uuid, payload ->> 'note' from restore_relationships;
  insert into public.custom_events (id, name, content, event_date, location, created_by, person_id)
  select (payload ->> 'id')::uuid, payload ->> 'name', payload ->> 'content', (payload ->> 'event_date')::date, payload ->> 'location', caller_id, (payload ->> 'person_id')::uuid from restore_events;
  insert into public.sources (id, title, source_type, author, publisher, publication_date, url, repository, note, created_by)
  select (payload ->> 'id')::uuid, payload ->> 'title', payload ->> 'source_type', payload ->> 'author', payload ->> 'publisher', (payload ->> 'publication_date')::date, payload ->> 'url', payload ->> 'repository', payload ->> 'note', caller_id from restore_sources;
  insert into public.person_citations (id, person_id, source_id, field_name, page_reference, quotation, confidence, created_by)
  select (payload ->> 'id')::uuid, (payload ->> 'person_id')::uuid, (payload ->> 'source_id')::uuid, payload ->> 'field_name', payload ->> 'page_reference', payload ->> 'quotation', payload ->> 'confidence', caller_id from restore_person_citations;
  insert into public.gallery_items (id, title, description, image_url, event_date, created_by, person_id)
  select (payload ->> 'id')::uuid, payload ->> 'title', payload ->> 'description', payload ->> 'image_url', (payload ->> 'event_date')::date, caller_id, (payload ->> 'person_id')::uuid from restore_gallery_items;

  if import_payload ->> 'version' = '3' then
    return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count);
  end if;

  if import_payload ->> 'version' = '4' then
    return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count, 'sources', sources_count, 'person_citations', citations_count);
  end if;

  return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count, 'sources', sources_count, 'person_citations', citations_count, 'gallery_items', gallery_items_count);
end;
$$;

revoke all on function public.restore_backup(jsonb) from public, anon;
grant execute on function public.restore_backup(jsonb) to authenticated;


      or (
        e.payload ->> 'person_id' is not null
        and not exists (
          select 1
          from restore_persons p
          where p.payload ->> 'id' = e.payload ->> 'person_id'
        )
      )
  ) or exists (
    select 1 from restore_events group by payload ->> 'id' having count(*) > 1
  ) then raise exception 'Invalid custom event in backup payload.'; end if;

  if exists (
    select 1 from restore_sources s
    where coalesce(s.payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or nullif(btrim(s.payload ->> 'title'), '') is null or length(s.payload ->> 'title') > 200
      or coalesce(s.payload ->> 'source_type', '') not in ('document', 'book', 'oral_history', 'website', 'photo', 'other')
      or length(coalesce(payload ->> 'author', '')) > 300 or length(coalesce(payload ->> 'publisher', '')) > 300
      or length(coalesce(payload ->> 'url', '')) > 2048 or (payload ->> 'url' is not null and payload ->> 'url' !~* '^https?://[^[:space:]]+$')
      or length(coalesce(payload ->> 'repository', '')) > 500 or length(coalesce(payload ->> 'note', '')) > 5000
  ) or exists (select 1 from restore_sources group by payload ->> 'id' having count(*) > 1) then
    raise exception 'Invalid source in backup payload.';
  end if;

  if exists (
    select 1 from restore_person_citations c
    where coalesce(c.payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or not exists (select 1 from restore_persons p where p.payload ->> 'id' = c.payload ->> 'person_id')
      or not exists (select 1 from restore_sources s where s.payload ->> 'id' = c.payload ->> 'source_id')
      or (c.payload ->> 'field_name' is not null and c.payload ->> 'field_name' not in ('birth_date', 'death_date', 'relationship', 'note', 'other'))
      or length(coalesce(c.payload ->> 'page_reference', '')) > 300 or length(coalesce(c.payload ->> 'quotation', '')) > 5000
      or c.payload ->> 'confidence' not in ('primary', 'secondary', 'uncertain')
  ) or exists (select 1 from restore_person_citations group by payload ->> 'id' having count(*) > 1) then
    raise exception 'Invalid person citation in backup payload.';
  end if;

  if exists (
    select 1 from restore_gallery_items item
    where coalesce(item.payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or nullif(btrim(item.payload ->> 'title'), '') is null
      or length(item.payload ->> 'title') > 200
      or length(coalesce(item.payload ->> 'description', '')) > 2000
      or nullif(btrim(item.payload ->> 'image_url'), '') is null
      or length(item.payload ->> 'image_url') > 2048
      or (item.payload ->> 'event_date' is not null and item.payload ->> 'event_date' !~ '^d{4}-d{2}-d{2}$')
      or (
        item.payload ->> 'person_id' is not null
        and not exists (
          select 1 from restore_persons person
          where person.payload ->> 'id' = item.payload ->> 'person_id'
        )
      )
  ) or exists (
    select 1 from restore_gallery_items group by payload ->> 'id' having count(*) > 1
  ) then
    raise exception 'Invalid gallery item in backup payload.';
  end if;

  delete from public.gallery_items;
  delete from public.person_citations;
  delete from public.sources;
  delete from public.custom_events;
  delete from public.relationships;
  delete from public.person_details_private;
  delete from public.persons;

  insert into public.persons (id, full_name, gender, birth_year, birth_month, birth_day, death_year, death_month, death_day, death_lunar_year, death_lunar_month, death_lunar_day, is_deceased, is_in_law, birth_order, generation, other_names, avatar_url, note, privacy_level)
  select (payload ->> 'id')::uuid, payload ->> 'full_name', (payload ->> 'gender')::public.gender_enum, (payload ->> 'birth_year')::integer, (payload ->> 'birth_month')::integer, (payload ->> 'birth_day')::integer, (payload ->> 'death_year')::integer, (payload ->> 'death_month')::integer, (payload ->> 'death_day')::integer, (payload ->> 'death_lunar_year')::integer, (payload ->> 'death_lunar_month')::integer, (payload ->> 'death_lunar_day')::integer, coalesce((payload ->> 'is_deceased')::boolean, false), coalesce((payload ->> 'is_in_law')::boolean, false), (payload ->> 'birth_order')::integer, (payload ->> 'generation')::integer, payload ->> 'other_names', payload ->> 'avatar_url', payload ->> 'note', coalesce(payload ->> 'privacy_level', 'family') from restore_persons;
  insert into public.person_details_private (person_id, phone_number, occupation, current_residence)
  select (payload ->> 'person_id')::uuid, payload ->> 'phone_number', payload ->> 'occupation', payload ->> 'current_residence' from restore_private_details;
  insert into public.relationships (type, person_a, person_b, note)
  select (payload ->> 'type')::public.relationship_type_enum, (payload ->> 'person_a')::uuid, (payload ->> 'person_b')::uuid, payload ->> 'note' from restore_relationships;
  insert into public.custom_events (id, name, content, event_date, location, created_by, person_id)
  select (payload ->> 'id')::uuid, payload ->> 'name', payload ->> 'content', (payload ->> 'event_date')::date, payload ->> 'location', caller_id, (payload ->> 'person_id')::uuid from restore_events;
  insert into public.sources (id, title, source_type, author, publisher, publication_date, url, repository, note, created_by)
  select (payload ->> 'id')::uuid, payload ->> 'title', payload ->> 'source_type', payload ->> 'author', payload ->> 'publisher', (payload ->> 'publication_date')::date, payload ->> 'url', payload ->> 'repository', payload ->> 'note', caller_id from restore_sources;
  insert into public.person_citations (id, person_id, source_id, field_name, page_reference, quotation, confidence, created_by)
  select (payload ->> 'id')::uuid, (payload ->> 'person_id')::uuid, (payload ->> 'source_id')::uuid, payload ->> 'field_name', payload ->> 'page_reference', payload ->> 'quotation', payload ->> 'confidence', caller_id from restore_person_citations;
  insert into public.gallery_items (id, title, description, image_url, event_date, created_by, person_id)
  select (payload ->> 'id')::uuid, payload ->> 'title', payload ->> 'description', payload ->> 'image_url', (payload ->> 'event_date')::date, caller_id, (payload ->> 'person_id')::uuid from restore_gallery_items;

  if import_payload ->> 'version' = '3' then
    return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count);
  end if;

  if import_payload ->> 'version' = '4' then
    return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count, 'sources', sources_count, 'person_citations', citations_count);
  end if;

  return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count, 'sources', sources_count, 'person_citations', citations_count, 'gallery_items', gallery_items_count);
end;
$$;

revoke all on function public.restore_backup(jsonb) from public, anon;
grant execute on function public.restore_backup(jsonb) to authenticated;
)
      or (
        item.payload ->> 'person_id' is not null
        and not exists (
          select 1 from restore_persons person
          where person.payload ->> 'id' = item.payload ->> 'person_id'
        )
      )
  ) or exists (
    select 1 from restore_gallery_items group by payload ->> 'id' having count(*) > 1
  ) then
    raise exception 'Invalid gallery item in backup payload.';
  end if;

  delete from public.gallery_items;
  delete from public.person_citations;
  delete from public.sources;
  delete from public.custom_events;
  delete from public.relationships;
  delete from public.person_details_private;
  delete from public.persons;

  insert into public.persons (id, full_name, gender, birth_year, birth_month, birth_day, death_year, death_month, death_day, death_lunar_year, death_lunar_month, death_lunar_day, is_deceased, is_in_law, birth_order, generation, other_names, avatar_url, note, privacy_level)
  select (payload ->> 'id')::uuid, payload ->> 'full_name', (payload ->> 'gender')::public.gender_enum, (payload ->> 'birth_year')::integer, (payload ->> 'birth_month')::integer, (payload ->> 'birth_day')::integer, (payload ->> 'death_year')::integer, (payload ->> 'death_month')::integer, (payload ->> 'death_day')::integer, (payload ->> 'death_lunar_year')::integer, (payload ->> 'death_lunar_month')::integer, (payload ->> 'death_lunar_day')::integer, coalesce((payload ->> 'is_deceased')::boolean, false), coalesce((payload ->> 'is_in_law')::boolean, false), (payload ->> 'birth_order')::integer, (payload ->> 'generation')::integer, payload ->> 'other_names', payload ->> 'avatar_url', payload ->> 'note', coalesce(payload ->> 'privacy_level', 'family') from restore_persons;
  insert into public.person_details_private (person_id, phone_number, occupation, current_residence)
  select (payload ->> 'person_id')::uuid, payload ->> 'phone_number', payload ->> 'occupation', payload ->> 'current_residence' from restore_private_details;
  insert into public.relationships (type, person_a, person_b, note)
  select (payload ->> 'type')::public.relationship_type_enum, (payload ->> 'person_a')::uuid, (payload ->> 'person_b')::uuid, payload ->> 'note' from restore_relationships;
  insert into public.custom_events (id, name, content, event_date, location, created_by, person_id)
  select (payload ->> 'id')::uuid, payload ->> 'name', payload ->> 'content', (payload ->> 'event_date')::date, payload ->> 'location', caller_id, (payload ->> 'person_id')::uuid from restore_events;
  insert into public.sources (id, title, source_type, author, publisher, publication_date, url, repository, note, created_by)
  select (payload ->> 'id')::uuid, payload ->> 'title', payload ->> 'source_type', payload ->> 'author', payload ->> 'publisher', (payload ->> 'publication_date')::date, payload ->> 'url', payload ->> 'repository', payload ->> 'note', caller_id from restore_sources;
  insert into public.person_citations (id, person_id, source_id, field_name, page_reference, quotation, confidence, created_by)
  select (payload ->> 'id')::uuid, (payload ->> 'person_id')::uuid, (payload ->> 'source_id')::uuid, payload ->> 'field_name', payload ->> 'page_reference', payload ->> 'quotation', payload ->> 'confidence', caller_id from restore_person_citations;
  insert into public.gallery_items (id, title, description, image_url, event_date, created_by, person_id)
  select (payload ->> 'id')::uuid, payload ->> 'title', payload ->> 'description', payload ->> 'image_url', (payload ->> 'event_date')::date, caller_id, (payload ->> 'person_id')::uuid from restore_gallery_items;

  if import_payload ->> 'version' = '3' then
    return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count);
  end if;

  if import_payload ->> 'version' = '4' then
    return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count, 'sources', sources_count, 'person_citations', citations_count);
  end if;

  return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count, 'sources', sources_count, 'person_citations', citations_count, 'gallery_items', gallery_items_count);
end;
$$;

revoke all on function public.restore_backup(jsonb) from public, anon;
grant execute on function public.restore_backup(jsonb) to authenticated;

      or (
        e.payload ->> 'person_id' is not null
        and not exists (
          select 1
          from restore_persons p
          where p.payload ->> 'id' = e.payload ->> 'person_id'
        )
      )
  ) or exists (
    select 1 from restore_events group by payload ->> 'id' having count(*) > 1
  ) then raise exception 'Invalid custom event in backup payload.'; end if;

  if exists (
    select 1 from restore_sources s
    where coalesce(s.payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or nullif(btrim(s.payload ->> 'title'), '') is null or length(s.payload ->> 'title') > 200
      or coalesce(s.payload ->> 'source_type', '') not in ('document', 'book', 'oral_history', 'website', 'photo', 'other')
      or length(coalesce(payload ->> 'author', '')) > 300 or length(coalesce(payload ->> 'publisher', '')) > 300
      or length(coalesce(payload ->> 'url', '')) > 2048 or (payload ->> 'url' is not null and payload ->> 'url' !~* '^https?://[^[:space:]]+$')
      or length(coalesce(payload ->> 'repository', '')) > 500 or length(coalesce(payload ->> 'note', '')) > 5000
  ) or exists (select 1 from restore_sources group by payload ->> 'id' having count(*) > 1) then
    raise exception 'Invalid source in backup payload.';
  end if;

  if exists (
    select 1 from restore_person_citations c
    where coalesce(c.payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or not exists (select 1 from restore_persons p where p.payload ->> 'id' = c.payload ->> 'person_id')
      or not exists (select 1 from restore_sources s where s.payload ->> 'id' = c.payload ->> 'source_id')
      or (c.payload ->> 'field_name' is not null and c.payload ->> 'field_name' not in ('birth_date', 'death_date', 'relationship', 'note', 'other'))
      or length(coalesce(c.payload ->> 'page_reference', '')) > 300 or length(coalesce(c.payload ->> 'quotation', '')) > 5000
      or c.payload ->> 'confidence' not in ('primary', 'secondary', 'uncertain')
  ) or exists (select 1 from restore_person_citations group by payload ->> 'id' having count(*) > 1) then
    raise exception 'Invalid person citation in backup payload.';
  end if;

  if exists (
    select 1 from restore_gallery_items item
    where coalesce(item.payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or nullif(btrim(item.payload ->> 'title'), '') is null
      or length(item.payload ->> 'title') > 200
      or length(coalesce(item.payload ->> 'description', '')) > 2000
      or nullif(btrim(item.payload ->> 'image_url'), '') is null
      or length(item.payload ->> 'image_url') > 2048
      or (item.payload ->> 'event_date' is not null and item.payload ->> 'event_date' !~ '^d{4}-d{2}-d{2}$')
      or (
        item.payload ->> 'person_id' is not null
        and not exists (
          select 1 from restore_persons person
          where person.payload ->> 'id' = item.payload ->> 'person_id'
        )
      )
  ) or exists (
    select 1 from restore_gallery_items group by payload ->> 'id' having count(*) > 1
  ) then
    raise exception 'Invalid gallery item in backup payload.';
  end if;

  delete from public.gallery_items;
  delete from public.person_citations;
  delete from public.sources;
  delete from public.custom_events;
  delete from public.relationships;
  delete from public.person_details_private;
  delete from public.persons;

  insert into public.persons (id, full_name, gender, birth_year, birth_month, birth_day, death_year, death_month, death_day, death_lunar_year, death_lunar_month, death_lunar_day, is_deceased, is_in_law, birth_order, generation, other_names, avatar_url, note, privacy_level)
  select (payload ->> 'id')::uuid, payload ->> 'full_name', (payload ->> 'gender')::public.gender_enum, (payload ->> 'birth_year')::integer, (payload ->> 'birth_month')::integer, (payload ->> 'birth_day')::integer, (payload ->> 'death_year')::integer, (payload ->> 'death_month')::integer, (payload ->> 'death_day')::integer, (payload ->> 'death_lunar_year')::integer, (payload ->> 'death_lunar_month')::integer, (payload ->> 'death_lunar_day')::integer, coalesce((payload ->> 'is_deceased')::boolean, false), coalesce((payload ->> 'is_in_law')::boolean, false), (payload ->> 'birth_order')::integer, (payload ->> 'generation')::integer, payload ->> 'other_names', payload ->> 'avatar_url', payload ->> 'note', coalesce(payload ->> 'privacy_level', 'family') from restore_persons;
  insert into public.person_details_private (person_id, phone_number, occupation, current_residence)
  select (payload ->> 'person_id')::uuid, payload ->> 'phone_number', payload ->> 'occupation', payload ->> 'current_residence' from restore_private_details;
  insert into public.relationships (type, person_a, person_b, note)
  select (payload ->> 'type')::public.relationship_type_enum, (payload ->> 'person_a')::uuid, (payload ->> 'person_b')::uuid, payload ->> 'note' from restore_relationships;
  insert into public.custom_events (id, name, content, event_date, location, created_by, person_id)
  select (payload ->> 'id')::uuid, payload ->> 'name', payload ->> 'content', (payload ->> 'event_date')::date, payload ->> 'location', caller_id, (payload ->> 'person_id')::uuid from restore_events;
  insert into public.sources (id, title, source_type, author, publisher, publication_date, url, repository, note, created_by)
  select (payload ->> 'id')::uuid, payload ->> 'title', payload ->> 'source_type', payload ->> 'author', payload ->> 'publisher', (payload ->> 'publication_date')::date, payload ->> 'url', payload ->> 'repository', payload ->> 'note', caller_id from restore_sources;
  insert into public.person_citations (id, person_id, source_id, field_name, page_reference, quotation, confidence, created_by)
  select (payload ->> 'id')::uuid, (payload ->> 'person_id')::uuid, (payload ->> 'source_id')::uuid, payload ->> 'field_name', payload ->> 'page_reference', payload ->> 'quotation', payload ->> 'confidence', caller_id from restore_person_citations;
  insert into public.gallery_items (id, title, description, image_url, event_date, created_by, person_id)
  select (payload ->> 'id')::uuid, payload ->> 'title', payload ->> 'description', payload ->> 'image_url', (payload ->> 'event_date')::date, caller_id, (payload ->> 'person_id')::uuid from restore_gallery_items;

  if import_payload ->> 'version' = '3' then
    return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count);
  end if;

  if import_payload ->> 'version' = '4' then
    return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count, 'sources', sources_count, 'person_citations', citations_count);
  end if;

  return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count, 'sources', sources_count, 'person_citations', citations_count, 'gallery_items', gallery_items_count);
end;
$$;

revoke all on function public.restore_backup(jsonb) from public, anon;
grant execute on function public.restore_backup(jsonb) to authenticated;


-- ========================================================
-- 11. AUDIT LOG MODULE
-- ========================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  table_name text NOT NULL CHECK (table_name IN ('persons', 'relationships', 'custom_events', 'gallery_items', 'profiles', 'person_details_private')),
  record_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  actor_user_id uuid,
  old_data jsonb,
  new_data jsonb
);

CREATE INDEX IF NOT EXISTS audit_log_occurred_at_id_idx ON public.audit_log (occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_log_record_id_idx ON public.audit_log (record_id);
CREATE INDEX IF NOT EXISTS audit_log_actor_user_id_idx ON public.audit_log (actor_user_id);
CREATE INDEX IF NOT EXISTS audit_log_table_name_occurred_at_idx ON public.audit_log (table_name, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_log_operation_occurred_at_idx ON public.audit_log (operation, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_user_id_occurred_at_idx ON public.audit_log (actor_user_id, occurred_at DESC, id DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.audit_log FROM public, anon, authenticated;
GRANT SELECT ON public.audit_log TO authenticated;

DROP POLICY IF EXISTS "Active users can view audit summaries" ON public.audit_log;
DROP POLICY IF EXISTS "Admins and editors can view audit log" ON public.audit_log;
CREATE POLICY "Admins and editors can view audit log"
ON public.audit_log
FOR SELECT
TO authenticated
USING (public.is_admin() OR public.is_editor());

CREATE OR REPLACE FUNCTION public.write_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  private_old_data jsonb;
  private_new_data jsonb;
BEGIN
  IF tg_table_schema <> 'public'
    OR tg_table_name NOT IN ('persons', 'relationships', 'custom_events', 'gallery_items', 'profiles', 'person_details_private') THEN
    RAISE EXCEPTION 'Unsupported audit trigger source: %.%', tg_table_schema, tg_table_name;
  END IF;

  IF tg_table_name = 'person_details_private' THEN
    IF tg_op = 'INSERT' THEN
      SELECT jsonb_build_object(
        'redacted', true,
        'changed_fields', coalesce(jsonb_agg(field_name ORDER BY field_name), '[]'::jsonb)
      )
      INTO private_new_data
      FROM jsonb_object_keys(to_jsonb(new)) AS fields(field_name)
      WHERE field_name NOT IN ('created_at', 'updated_at');
    ELSIF tg_op = 'UPDATE' THEN
      SELECT jsonb_build_object(
        'redacted', true,
        'changed_fields', coalesce(jsonb_agg(field_name ORDER BY field_name), '[]'::jsonb)
      )
      INTO private_new_data
      FROM jsonb_object_keys(to_jsonb(new)) AS fields(field_name)
      WHERE field_name NOT IN ('created_at', 'updated_at')
        AND (to_jsonb(old) -> field_name) IS DISTINCT FROM (to_jsonb(new) -> field_name);
      private_old_data := jsonb_build_object('redacted', true);
    ELSE
      SELECT jsonb_build_object(
        'redacted', true,
        'changed_fields', coalesce(jsonb_agg(field_name ORDER BY field_name), '[]'::jsonb)
      )
      INTO private_old_data
      FROM jsonb_object_keys(to_jsonb(old)) AS fields(field_name)
      WHERE field_name NOT IN ('created_at', 'updated_at');
    END IF;

    INSERT INTO public.audit_log (table_name, record_id, operation, actor_user_id, old_data, new_data)
    VALUES (
      tg_table_name,
      coalesce(new.person_id, old.person_id),
      tg_op,
      auth.uid(),
      private_old_data,
      private_new_data
    );
  ELSE
    INSERT INTO public.audit_log (table_name, record_id, operation, actor_user_id, old_data, new_data)
    VALUES (
      tg_table_name,
      coalesce(new.id, old.id),
      tg_op,
      auth.uid(),
      CASE WHEN tg_op IN ('UPDATE', 'DELETE') THEN to_jsonb(old) END,
      CASE WHEN tg_op IN ('INSERT', 'UPDATE') THEN to_jsonb(new) END
    );
  END IF;

  RETURN coalesce(new, old);
END;
$$;

REVOKE ALL ON FUNCTION public.write_audit_log() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_audit_log_truncation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Audit log cannot be truncated.';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_audit_log_truncation() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS tr_prevent_audit_log_truncate ON public.audit_log;
CREATE TRIGGER tr_prevent_audit_log_truncate
BEFORE TRUNCATE ON public.audit_log
FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_audit_log_truncation();

ALTER TABLE public.audit_log ENABLE ALWAYS TRIGGER tr_prevent_audit_log_truncate;

DROP TRIGGER IF EXISTS tr_audit_persons ON public.persons;
CREATE TRIGGER tr_audit_persons AFTER INSERT OR UPDATE OR DELETE ON public.persons FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

DROP TRIGGER IF EXISTS tr_audit_relationships ON public.relationships;
CREATE TRIGGER tr_audit_relationships AFTER INSERT OR UPDATE OR DELETE ON public.relationships FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

DROP TRIGGER IF EXISTS tr_audit_custom_events ON public.custom_events;
CREATE TRIGGER tr_audit_custom_events AFTER INSERT OR UPDATE OR DELETE ON public.custom_events FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

DROP TRIGGER IF EXISTS tr_audit_gallery_items ON public.gallery_items;
CREATE TRIGGER tr_audit_gallery_items AFTER INSERT OR UPDATE OR DELETE ON public.gallery_items FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

DROP TRIGGER IF EXISTS tr_audit_profiles ON public.profiles;
CREATE TRIGGER tr_audit_profiles AFTER INSERT OR UPDATE OR DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

DROP TRIGGER IF EXISTS tr_audit_person_details_private ON public.person_details_private;
CREATE TRIGGER tr_audit_person_details_private AFTER INSERT OR UPDATE OR DELETE ON public.person_details_private FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

+-- Safe undo RPC for recent audit log entries
alter table public.audit_log
  add column if not exists undone_audit_id bigint references public.audit_log(id) on delete set null;

create index if not exists audit_log_undone_audit_id_idx on public.audit_log(undone_audit_id);

create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  private_old_data jsonb;
  private_new_data jsonb;
  active_undone_audit_id bigint;
  undone_id_text text;
begin
  if tg_table_schema <> 'public'
    or tg_table_name not in ('persons', 'relationships', 'custom_events', 'gallery_items', 'profiles', 'person_details_private') then
    raise exception 'Unsupported audit trigger source: %.%', tg_table_schema, tg_table_name;
  end if;

  undone_id_text := current_setting('audit.undone_audit_id', true);
  if undone_id_text is not null and undone_id_text ~ '^\d+$' then
    active_undone_audit_id := undone_id_text::bigint;
  else
    active_undone_audit_id := null;
  end if;

  if tg_table_name = 'person_details_private' then
    if tg_op = 'INSERT' then
      select jsonb_build_object(
        'redacted', true,
        'changed_fields', coalesce(jsonb_agg(field_name order by field_name), '[]'::jsonb)
      )
      into private_new_data
      from jsonb_object_keys(to_jsonb(new)) as fields(field_name)
      where field_name not in ('created_at', 'updated_at');
    elsif tg_op = 'UPDATE' then
      select jsonb_build_object(
        'redacted', true,
        'changed_fields', coalesce(jsonb_agg(field_name order by field_name), '[]'::jsonb)
      )
      into private_new_data
      from jsonb_object_keys(to_jsonb(new)) as fields(field_name)
      where field_name not in ('created_at', 'updated_at')
        and (to_jsonb(old) -> field_name) is distinct from (to_jsonb(new) -> field_name);
      private_old_data := jsonb_build_object('redacted', true);
    else
      select jsonb_build_object(
        'redacted', true,
        'changed_fields', coalesce(jsonb_agg(field_name order by field_name), '[]'::jsonb)
      )
      into private_old_data
      from jsonb_object_keys(to_jsonb(old)) as fields(field_name)
      where field_name not in ('created_at', 'updated_at');
    end if;

    insert into public.audit_log (table_name, record_id, operation, actor_user_id, old_data, new_data, undone_audit_id)
    values (
      tg_table_name,
      coalesce(new.person_id, old.person_id),
      tg_op,
      auth.uid(),
      private_old_data,
      private_new_data,
      active_undone_audit_id
    );
  else
    insert into public.audit_log (table_name, record_id, operation, actor_user_id, old_data, new_data, undone_audit_id)
    values (
      tg_table_name,
      coalesce(new.id, old.id),
      tg_op,
      auth.uid(),
      case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
      case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
      active_undone_audit_id
    );
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function public.write_audit_log() from public, anon, authenticated;

create or replace function public.undo_audit_entry(audit_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry record;
  is_admin_user boolean := false;
  is_editor_user boolean := false;
  current_row_json jsonb;
  expected_row_json jsonb;
  target_person public.persons%rowtype;
  target_rel public.relationships%rowtype;
  target_evt public.custom_events%rowtype;
  target_gallery public.gallery_items%rowtype;
  affected_table text;
  affected_id uuid;
  affected_op text;
begin
  if audit_id is null or audit_id <= 0 then
    raise exception 'Invalid audit id.';
  end if;

  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active = true
  ) into is_admin_user;

  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'editor' and is_active = true
  ) into is_editor_user;

  if not (is_admin_user or is_editor_user) then
    raise exception 'Access denied.';
  end if;

  select *
  into entry
  from public.audit_log
  where id = audit_id
  for update;

  if not found then
    raise exception 'Audit entry not found.';
  end if;

  if entry.occurred_at < now() - interval '24 hours' then
    raise exception 'Undo window has expired.';
  end if;

  if exists (
    select 1 from public.audit_log
    where undone_audit_id = entry.id
  ) then
    raise exception 'Audit entry has already been undone.';
  end if;

  affected_table := entry.table_name;
  affected_id := entry.record_id;
  affected_op := entry.operation;

  if not (
    (affected_table = 'persons' and affected_op = 'UPDATE')
    or (affected_table = 'relationships' and affected_op in ('INSERT', 'DELETE'))
    or (affected_table = 'custom_events' and affected_op in ('INSERT', 'UPDATE', 'DELETE'))
    or (affected_table = 'gallery_items' and affected_op = 'UPDATE')
  ) then
    raise exception 'Undo is not supported for this change type.';
  end if;

  if affected_table = 'gallery_items' and not is_admin_user then
    raise exception 'Access denied.';
  end if;

  if affected_table = 'gallery_items' and exists (
    select 1
    from jsonb_object_keys(entry.new_data) as fields(field_name)
    where (entry.old_data -> field_name) is distinct from (entry.new_data -> field_name)
      and field_name not in ('title', 'description', 'event_date')
  ) then
    raise exception 'Undo is not supported for gallery storage or ownership changes.';
  end if;

  perform set_config('audit.undone_audit_id', entry.id::text, true);

  if affected_table = 'persons' and affected_op = 'UPDATE' then
    select * into target_person from public.persons where id = affected_id for update;
    if not found then
      raise exception 'Conflict detected: target record no longer exists.';
    end if;

    current_row_json := to_jsonb(target_person);
    expected_row_json := entry.new_data;

    if current_row_json is distinct from expected_row_json then
      raise exception 'Conflict detected: person no longer matches the audited state.';
    end if;

    update public.persons
    set
      full_name = coalesce((entry.old_data->>'full_name'), full_name),
      gender = (entry.old_data->>'gender')::public.gender_enum,
      birth_year = case when entry.old_data ? 'birth_year' then (entry.old_data->>'birth_year')::int else birth_year end,
      birth_month = case when entry.old_data ? 'birth_month' then (entry.old_data->>'birth_month')::int else birth_month end,
      birth_day = case when entry.old_data ? 'birth_day' then (entry.old_data->>'birth_day')::int else birth_day end,
      death_year = case when entry.old_data ? 'death_year' then (entry.old_data->>'death_year')::int else death_year end,
      death_month = case when entry.old_data ? 'death_month' then (entry.old_data->>'death_month')::int else death_month end,
      death_day = case when entry.old_data ? 'death_day' then (entry.old_data->>'death_day')::int else death_day end,
      death_lunar_year = case when entry.old_data ? 'death_lunar_year' then (entry.old_data->>'death_lunar_year')::int else death_lunar_year end,
      death_lunar_month = case when entry.old_data ? 'death_lunar_month' then (entry.old_data->>'death_lunar_month')::int else death_lunar_month end,
      death_lunar_day = case when entry.old_data ? 'death_lunar_day' then (entry.old_data->>'death_lunar_day')::int else death_lunar_day end,
      is_deceased = coalesce((entry.old_data->>'is_deceased')::boolean, is_deceased),
      is_in_law = coalesce((entry.old_data->>'is_in_law')::boolean, is_in_law),
      birth_order = case when entry.old_data ? 'birth_order' then (entry.old_data->>'birth_order')::int else birth_order end,
      generation = case when entry.old_data ? 'generation' then (entry.old_data->>'generation')::int else generation end,
      other_names = case when entry.old_data ? 'other_names' then entry.old_data->>'other_names' else other_names end,
      avatar_url = case when entry.old_data ? 'avatar_url' then entry.old_data->>'avatar_url' else avatar_url end,
      note = case when entry.old_data ? 'note' then entry.old_data->>'note' else note end
    where id = affected_id;

  elsif affected_table = 'relationships' and affected_op = 'INSERT' then
    select * into target_rel from public.relationships where id = affected_id for update;
    if not found then
      raise exception 'Conflict detected: relationship already deleted.';
    end if;

    current_row_json := to_jsonb(target_rel);
    expected_row_json := entry.new_data;
    if current_row_json is distinct from expected_row_json then
      raise exception 'Conflict detected: relationship no longer matches the audited state.';
    end if;

    delete from public.relationships where id = affected_id;

  elsif affected_table = 'relationships' and affected_op = 'DELETE' then
    if exists (select 1 from public.relationships where id = affected_id) then
      raise exception 'Conflict detected: relationship with this id already exists.';
    end if;

    if not exists (select 1 from public.persons where id = (entry.old_data->>'person_a')::uuid)
       or not exists (select 1 from public.persons where id = (entry.old_data->>'person_b')::uuid) then
      raise exception 'Conflict detected: related person no longer exists.';
    end if;

    insert into public.relationships (id, type, person_a, person_b, note, created_at, updated_at)
    values (
      affected_id,
      (entry.old_data->>'type')::public.relationship_type_enum,
      (entry.old_data->>'person_a')::uuid,
      (entry.old_data->>'person_b')::uuid,
      entry.old_data->>'note',
      (entry.old_data->>'created_at')::timestamptz,
      (entry.old_data->>'updated_at')::timestamptz
    );

  elsif affected_table = 'custom_events' and affected_op = 'INSERT' then
    select * into target_evt from public.custom_events where id = affected_id for update;
    if not found then
      raise exception 'Conflict detected: custom event already removed.';
    end if;

    current_row_json := to_jsonb(target_evt);
    expected_row_json := entry.new_data;
    if current_row_json is distinct from expected_row_json then
      raise exception 'Conflict detected: custom event no longer matches the audited state.';
    end if;

    delete from public.custom_events where id = affected_id;

  elsif affected_table = 'custom_events' and affected_op = 'UPDATE' then
    select * into target_evt from public.custom_events where id = affected_id for update;
    if not found then
      raise exception 'Conflict detected: custom event does not exist.';
    end if;

    current_row_json := to_jsonb(target_evt);
    expected_row_json := entry.new_data;
    if current_row_json is distinct from expected_row_json then
      raise exception 'Conflict detected: custom event no longer matches the audited state.';
    end if;

    update public.custom_events
    set
      name = coalesce(entry.old_data->>'name', name),
      content = case when entry.old_data ? 'content' then entry.old_data->>'content' else content end,
      event_date = coalesce((entry.old_data->>'event_date')::date, event_date),
      location = case when entry.old_data ? 'location' then entry.old_data->>'location' else location end,
      created_by = case when entry.old_data ? 'created_by' then (entry.old_data->>'created_by')::uuid else created_by end
    where id = affected_id;

  elsif affected_table = 'custom_events' and affected_op = 'DELETE' then
    if exists (select 1 from public.custom_events where id = affected_id) then
      raise exception 'Conflict detected: custom event already exists.';
    end if;

    insert into public.custom_events (id, name, content, event_date, location, created_by, created_at, updated_at)
    values (
      affected_id,
      entry.old_data->>'name',
      entry.old_data->>'content',
      (entry.old_data->>'event_date')::date,
      entry.old_data->>'location',
      coalesce((entry.old_data->>'created_by')::uuid, auth.uid()),
      (entry.old_data->>'created_at')::timestamptz,
      (entry.old_data->>'updated_at')::timestamptz
    );

  elsif affected_table = 'gallery_items' and affected_op = 'UPDATE' then
    select * into target_gallery from public.gallery_items where id = affected_id for update;
    if not found then
      raise exception 'Conflict detected: gallery item does not exist.';
    end if;

    current_row_json := to_jsonb(target_gallery);
    expected_row_json := entry.new_data;

    if current_row_json is distinct from expected_row_json then
      raise exception 'Conflict detected: gallery item no longer matches the audited state.';
    end if;

    -- Metadata update ONLY: never modify image_url or storage
    update public.gallery_items
    set
      title = coalesce(entry.old_data->>'title', title),
      description = case when entry.old_data ? 'description' then entry.old_data->>'description' else description end,
      event_date = case when entry.old_data ? 'event_date' then (entry.old_data->>'event_date')::date else event_date end
    where id = affected_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'undone_audit_id', entry.id,
    'table_name', affected_table,
    'record_id', affected_id,
    'operation', affected_op
  );
end;
$$;

revoke all on function public.undo_audit_entry(bigint) from public, anon, authenticated;
grant execute on function public.undo_audit_entry(bigint) to authenticated;


-- ========================================================
-- 12. SOURCES & CITATIONS MODULE
-- ========================================================

CREATE TABLE IF NOT EXISTS public.sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  source_type TEXT NOT NULL,
  author TEXT,
  publisher TEXT,
  publication_date DATE,
  url TEXT,
  repository TEXT,
  note TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sources_title_chk CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT sources_source_type_chk CHECK (source_type IN ('document', 'book', 'oral_history', 'website', 'photo', 'other')),
  CONSTRAINT sources_author_length_chk CHECK (author IS NULL OR char_length(author) <= 300),
  CONSTRAINT sources_publisher_length_chk CHECK (publisher IS NULL OR char_length(publisher) <= 300),
  CONSTRAINT sources_url_length_chk CHECK (url IS NULL OR char_length(url) <= 2048),
  CONSTRAINT sources_url_protocol_chk CHECK (url IS NULL OR url ~* '^https?://[^[:space:]]+$'),
  CONSTRAINT sources_repository_length_chk CHECK (repository IS NULL OR char_length(repository) <= 500),
  CONSTRAINT sources_note_length_chk CHECK (note IS NULL OR char_length(note) <= 5000)
);

CREATE TABLE IF NOT EXISTS public.person_citations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES public.sources(id) ON DELETE CASCADE,
  field_name TEXT,
  page_reference TEXT,
  quotation TEXT,
  confidence TEXT NOT NULL DEFAULT 'uncertain',
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT person_citations_field_name_chk CHECK (field_name IS NULL OR field_name IN ('birth_date', 'death_date', 'relationship', 'note', 'other')),
  CONSTRAINT person_citations_page_reference_length_chk CHECK (page_reference IS NULL OR char_length(page_reference) <= 300),
  CONSTRAINT person_citations_quotation_length_chk CHECK (quotation IS NULL OR char_length(quotation) <= 5000),
  CONSTRAINT person_citations_confidence_chk CHECK (confidence IN ('primary', 'secondary', 'uncertain'))
);

CREATE INDEX IF NOT EXISTS idx_sources_title ON public.sources(title);
CREATE INDEX IF NOT EXISTS idx_sources_type ON public.sources(source_type);
CREATE INDEX IF NOT EXISTS idx_person_citations_person_id ON public.person_citations(person_id);
CREATE INDEX IF NOT EXISTS idx_person_citations_source_id ON public.person_citations(source_id);
CREATE UNIQUE INDEX IF NOT EXISTS person_citations_identical_uidx
  ON public.person_citations (
    person_id,
    source_id,
    coalesce(field_name, ''),
    coalesce(page_reference, ''),
    coalesce(quotation, ''),
    confidence
  );

DROP TRIGGER IF EXISTS tr_sources_updated_at ON public.sources;
CREATE TRIGGER tr_sources_updated_at BEFORE UPDATE ON public.sources FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_citations ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.prevent_source_owner_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.created_by IS DISTINCT FROM OLD.created_by AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can change a source owner.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_source_owner_change() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_citation_owner_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.created_by IS DISTINCT FROM OLD.created_by AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can change a citation owner.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_citation_owner_change() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS prevent_source_owner_change_trigger ON public.sources;
CREATE TRIGGER prevent_source_owner_change_trigger BEFORE UPDATE OF created_by ON public.sources FOR EACH ROW EXECUTE FUNCTION public.prevent_source_owner_change();
DROP TRIGGER IF EXISTS prevent_citation_owner_change_trigger ON public.person_citations;
CREATE TRIGGER prevent_citation_owner_change_trigger BEFORE UPDATE OF created_by ON public.person_citations FOR EACH ROW EXECUTE FUNCTION public.prevent_citation_owner_change();

REVOKE ALL ON TABLE public.sources FROM public, anon;
REVOKE ALL ON TABLE public.person_citations FROM public, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sources TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.person_citations TO authenticated;

DROP POLICY IF EXISTS "Active users can read sources" ON public.sources;
CREATE POLICY "Active users can read sources" ON public.sources FOR SELECT TO authenticated USING (public.is_active_user());
DROP POLICY IF EXISTS "Admins and editors can insert sources" ON public.sources;
CREATE POLICY "Admins and editors can insert sources" ON public.sources FOR INSERT TO authenticated WITH CHECK ((public.is_admin() OR public.is_editor()) AND auth.uid() = created_by);
DROP POLICY IF EXISTS "Admins and editors can update sources" ON public.sources;
CREATE POLICY "Admins and editors can update sources" ON public.sources FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_editor()) WITH CHECK (public.is_admin() OR public.is_editor());
DROP POLICY IF EXISTS "Admins and editors can delete sources" ON public.sources;
CREATE POLICY "Admins and editors can delete sources" ON public.sources FOR DELETE TO authenticated USING (public.is_admin() OR public.is_editor());

DROP POLICY IF EXISTS "Active users can read person citations" ON public.person_citations;
CREATE POLICY "Active users can read person citations" ON public.person_citations FOR SELECT TO authenticated USING (public.can_view_person(person_id));
DROP POLICY IF EXISTS "Admins and editors can insert person citations" ON public.person_citations;
CREATE POLICY "Admins and editors can insert person citations" ON public.person_citations FOR INSERT TO authenticated WITH CHECK ((public.is_admin() OR public.is_editor()) AND auth.uid() = created_by);
DROP POLICY IF EXISTS "Admins and editors can update person citations" ON public.person_citations;
CREATE POLICY "Admins and editors can update person citations" ON public.person_citations FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_editor()) WITH CHECK (public.is_admin() OR public.is_editor());
DROP POLICY IF EXISTS "Admins and editors can delete person citations" ON public.person_citations;
CREATE POLICY "Admins and editors can delete person citations" ON public.person_citations FOR DELETE TO authenticated USING (public.is_admin() OR public.is_editor());
-- Duplicate detection and controlled merge (20260903120000)
create extension if not exists unaccent with schema extensions;
create or replace function public.normalize_duplicate_name(input text) returns text;
create index if not exists persons_duplicate_normalized_name_idx on public.persons (public.normalize_duplicate_name(full_name));
alter table public.custom_events add column if not exists person_id uuid references public.persons(id) on delete set null;
alter table public.gallery_items add column if not exists person_id uuid references public.persons(id) on delete set null;
create or replace function public.find_duplicate_candidates(candidate_limit integer default 25, candidate_offset integer default 0) returns table (primary_person jsonb, duplicate_person jsonb);
create or replace function public.merge_person_records(primary_id uuid, duplicate_id uuid, resolution jsonb) returns uuid;

-- Member contribution review (20260903140000)
create table if not exists public.change_requests (
  id uuid primary key default gen_random_uuid(),
  target_table text not null check (target_table in ('persons', 'custom_events', 'sources', 'person_citations')),
  target_id uuid not null,
  operation text not null check (operation in ('INSERT', 'UPDATE')),
  proposed_data jsonb not null check (jsonb_typeof(proposed_data) = 'object' and proposed_data <> '{}'::jsonb),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  requester_id uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  reviewer_id uuid references public.profiles(id) on delete set null,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  withdrawn_at timestamptz
);
create index if not exists change_requests_requester_created_idx on public.change_requests (requester_id, created_at desc);
create index if not exists change_requests_review_queue_idx on public.change_requests (status, created_at) where status = 'pending';
alter table public.change_requests enable row level security;
create policy "Requesters can read own change requests" on public.change_requests for select to authenticated using (public.is_active_user() and requester_id = auth.uid());
create policy "Admins and editors can review change requests" on public.change_requests for select to authenticated using (public.is_admin() or public.is_editor());
create or replace function public.submit_change_request(target_table text, target_id uuid, operation text, proposed_data jsonb) returns uuid;
create or replace function public.approve_change_request(request_id uuid, note text default null) returns uuid;
create or replace function public.reject_change_request(request_id uuid, note text) returns uuid;
create or replace function public.withdraw_change_request(request_id uuid) returns uuid;


-- ==========================================
-- FAMILY TREE TOPOLOGY RPC & GALLERY STORAGE
-- ==========================================

DROP POLICY IF EXISTS "Gallery images are publicly accessible." ON storage.objects;
DROP POLICY IF EXISTS "Active users can view gallery objects" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view visible gallery objects" ON storage.objects;
CREATE POLICY "Authenticated users can view visible gallery objects"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'gallery'
  and exists (
      SELECT 1
      FROM public.gallery_items item
      WHERE public.is_active_user()
        AND (item.person_id IS NULL OR public.can_view_person(item.person_id))
        AND (item.image_url = name OR item.image_url LIKE '%/gallery/' || name)
  )
);

CREATE OR REPLACE FUNCTION public.get_family_tree_topology()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH relationship_access AS (
    SELECT
      relationship.id,
      relationship.type,
      relationship.person_a,
      relationship.person_b,
      relationship.note,
      public.can_view_person(relationship.person_a) AS can_view_a,
      public.can_view_person(relationship.person_b) AS can_view_b
    FROM public.relationships relationship
    WHERE public.is_active_user()
      AND (
        public.can_view_person(relationship.person_a)
        OR public.can_view_person(relationship.person_b)
      )
  ),
  visible_nodes AS (
    SELECT jsonb_build_object(
      'id', person.id::text,
      'full_name', person.full_name,
      'gender', person.gender,
      'birth_year', person.birth_year,
      'death_year', person.death_year,
      'death_lunar_year', person.death_lunar_year,
      'avatar_url', person.avatar_url,
      'updated_at', person.updated_at,
      'is_deceased', person.is_deceased,
      'is_in_law', person.is_in_law,
      'birth_order', person.birth_order,
      'generation', person.generation,
      'is_private_placeholder', false
    ) AS node
    FROM public.persons person
    WHERE public.can_view_person(person.id)
  ),
  hidden_endpoints AS (
    SELECT person_a AS person_id FROM relationship_access WHERE NOT can_view_a
    UNION
    SELECT person_b AS person_id FROM relationship_access WHERE NOT can_view_b
  ),
  hidden_nodes AS (
    SELECT jsonb_build_object(
      'id', 'private:' || md5(endpoint.person_id::text || ':' || auth.uid()::text),
      'full_name', 'Thành viên riêng tư',
      'gender', 'other',
      'birth_year', null,
      'death_year', null,
      'death_lunar_year', null,
      'avatar_url', null,
      'updated_at', null,
      'is_deceased', false,
      'is_in_law', false,
      'birth_order', null,
      'generation', null,
      'is_private_placeholder', true
    ) AS node
    FROM hidden_endpoints endpoint
  ),
  topology_edges AS (
    SELECT jsonb_build_object(
      'id', 'relationship:' || md5(access.id::text || ':' || auth.uid()::text),
      'type', access.type,
      'person_a', CASE
        WHEN access.can_view_a THEN access.person_a::text
        ELSE 'private:' || md5(access.person_a::text || ':' || auth.uid()::text)
      END,
      'person_b', CASE
        WHEN access.can_view_b THEN access.person_b::text
        ELSE 'private:' || md5(access.person_b::text || ':' || auth.uid()::text)
      END,
      'note', CASE WHEN access.can_view_a AND access.can_view_b THEN access.note ELSE null END,
      'created_at', null,
      'updated_at', null
    ) AS edge
    FROM relationship_access access
  )
  SELECT jsonb_build_object(
    'persons', COALESCE(
      (SELECT jsonb_agg(nodes.node ORDER BY nodes.node ->> 'id') FROM (
        SELECT node FROM visible_nodes
        UNION ALL
        SELECT node FROM hidden_nodes
      ) nodes),
      '[]'::jsonb
    ),
    'relationships', COALESCE(
      (SELECT jsonb_agg(topology_edges.edge ORDER BY topology_edges.edge ->> 'id') FROM topology_edges),
      '[]'::jsonb
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_family_tree_topology() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_family_tree_topology() TO authenticated;

      or (
        e.payload ->> 'person_id' is not null
        and not exists (
          select 1
          from restore_persons p
          where p.payload ->> 'id' = e.payload ->> 'person_id'
        )
      )
  ) or exists (
    select 1 from restore_events group by payload ->> 'id' having count(*) > 1
  ) then raise exception 'Invalid custom event in backup payload.'; end if;

  if exists (
    select 1 from restore_sources s
    where coalesce(s.payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or nullif(btrim(s.payload ->> 'title'), '') is null or length(s.payload ->> 'title') > 200
      or coalesce(s.payload ->> 'source_type', '') not in ('document', 'book', 'oral_history', 'website', 'photo', 'other')
      or length(coalesce(payload ->> 'author', '')) > 300 or length(coalesce(payload ->> 'publisher', '')) > 300
      or length(coalesce(payload ->> 'url', '')) > 2048 or (payload ->> 'url' is not null and payload ->> 'url' !~* '^https?://[^[:space:]]+$')
      or length(coalesce(payload ->> 'repository', '')) > 500 or length(coalesce(payload ->> 'note', '')) > 5000
  ) or exists (select 1 from restore_sources group by payload ->> 'id' having count(*) > 1) then
    raise exception 'Invalid source in backup payload.';
  end if;

  if exists (
    select 1 from restore_person_citations c
    where coalesce(c.payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or not exists (select 1 from restore_persons p where p.payload ->> 'id' = c.payload ->> 'person_id')
      or not exists (select 1 from restore_sources s where s.payload ->> 'id' = c.payload ->> 'source_id')
      or (c.payload ->> 'field_name' is not null and c.payload ->> 'field_name' not in ('birth_date', 'death_date', 'relationship', 'note', 'other'))
      or length(coalesce(c.payload ->> 'page_reference', '')) > 300 or length(coalesce(c.payload ->> 'quotation', '')) > 5000
      or c.payload ->> 'confidence' not in ('primary', 'secondary', 'uncertain')
  ) or exists (select 1 from restore_person_citations group by payload ->> 'id' having count(*) > 1) then
    raise exception 'Invalid person citation in backup payload.';
  end if;

  if exists (
    select 1 from restore_gallery_items item
    where coalesce(item.payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or nullif(btrim(item.payload ->> 'title'), '') is null
      or length(item.payload ->> 'title') > 200
      or length(coalesce(item.payload ->> 'description', '')) > 2000
      or nullif(btrim(item.payload ->> 'image_url'), '') is null
      or length(item.payload ->> 'image_url') > 2048
      or (item.payload ->> 'event_date' is not null and item.payload ->> 'event_date' !~ '^\d{4}-\d{2}-\d{2})
      or (
        item.payload ->> 'person_id' is not null
        and not exists (
          select 1 from restore_persons person
          where person.payload ->> 'id' = item.payload ->> 'person_id'
        )
      )
  ) or exists (
    select 1 from restore_gallery_items group by payload ->> 'id' having count(*) > 1
  ) then
    raise exception 'Invalid gallery item in backup payload.';
  end if;

  delete from public.gallery_items;
  delete from public.person_citations;
  delete from public.sources;
  delete from public.custom_events;
  delete from public.relationships;
  delete from public.person_details_private;
  delete from public.persons;

  insert into public.persons (id, full_name, gender, birth_year, birth_month, birth_day, death_year, death_month, death_day, death_lunar_year, death_lunar_month, death_lunar_day, is_deceased, is_in_law, birth_order, generation, other_names, avatar_url, note, privacy_level)
  select (payload ->> 'id')::uuid, payload ->> 'full_name', (payload ->> 'gender')::public.gender_enum, (payload ->> 'birth_year')::integer, (payload ->> 'birth_month')::integer, (payload ->> 'birth_day')::integer, (payload ->> 'death_year')::integer, (payload ->> 'death_month')::integer, (payload ->> 'death_day')::integer, (payload ->> 'death_lunar_year')::integer, (payload ->> 'death_lunar_month')::integer, (payload ->> 'death_lunar_day')::integer, coalesce((payload ->> 'is_deceased')::boolean, false), coalesce((payload ->> 'is_in_law')::boolean, false), (payload ->> 'birth_order')::integer, (payload ->> 'generation')::integer, payload ->> 'other_names', payload ->> 'avatar_url', payload ->> 'note', coalesce(payload ->> 'privacy_level', 'family') from restore_persons;
  insert into public.person_details_private (person_id, phone_number, occupation, current_residence)
  select (payload ->> 'person_id')::uuid, payload ->> 'phone_number', payload ->> 'occupation', payload ->> 'current_residence' from restore_private_details;
  insert into public.relationships (type, person_a, person_b, note)
  select (payload ->> 'type')::public.relationship_type_enum, (payload ->> 'person_a')::uuid, (payload ->> 'person_b')::uuid, payload ->> 'note' from restore_relationships;
  insert into public.custom_events (id, name, content, event_date, location, created_by, person_id)
  select (payload ->> 'id')::uuid, payload ->> 'name', payload ->> 'content', (payload ->> 'event_date')::date, payload ->> 'location', caller_id, (payload ->> 'person_id')::uuid from restore_events;
  insert into public.sources (id, title, source_type, author, publisher, publication_date, url, repository, note, created_by)
  select (payload ->> 'id')::uuid, payload ->> 'title', payload ->> 'source_type', payload ->> 'author', payload ->> 'publisher', (payload ->> 'publication_date')::date, payload ->> 'url', payload ->> 'repository', payload ->> 'note', caller_id from restore_sources;
  insert into public.person_citations (id, person_id, source_id, field_name, page_reference, quotation, confidence, created_by)
  select (payload ->> 'id')::uuid, (payload ->> 'person_id')::uuid, (payload ->> 'source_id')::uuid, payload ->> 'field_name', payload ->> 'page_reference', payload ->> 'quotation', payload ->> 'confidence', caller_id from restore_person_citations;
  insert into public.gallery_items (id, title, description, image_url, event_date, created_by, person_id)
  select (payload ->> 'id')::uuid, payload ->> 'title', payload ->> 'description', payload ->> 'image_url', (payload ->> 'event_date')::date, caller_id, (payload ->> 'person_id')::uuid from restore_gallery_items;

  if import_payload ->> 'version' = '3' then
    return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count);
  end if;

  if import_payload ->> 'version' = '4' then
    return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count, 'sources', sources_count, 'person_citations', citations_count);
  end if;

  return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count, 'sources', sources_count, 'person_citations', citations_count, 'gallery_items', gallery_items_count);
end;
$$;

revoke all on function public.restore_backup(jsonb) from public, anon;
grant execute on function public.restore_backup(jsonb) to authenticated;

-- ========================================================
-- 11. AUDIT LOG MODULE
-- ========================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  table_name text NOT NULL CHECK (table_name IN ('persons', 'relationships', 'custom_events', 'gallery_items', 'profiles', 'person_details_private')),
  record_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  actor_user_id uuid,
  old_data jsonb,
  new_data jsonb
);

CREATE INDEX IF NOT EXISTS audit_log_occurred_at_id_idx ON public.audit_log (occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_log_record_id_idx ON public.audit_log (record_id);
CREATE INDEX IF NOT EXISTS audit_log_actor_user_id_idx ON public.audit_log (actor_user_id);
CREATE INDEX IF NOT EXISTS audit_log_table_name_occurred_at_idx ON public.audit_log (table_name, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_log_operation_occurred_at_idx ON public.audit_log (operation, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_user_id_occurred_at_idx ON public.audit_log (actor_user_id, occurred_at DESC, id DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.audit_log FROM public, anon, authenticated;
GRANT SELECT ON public.audit_log TO authenticated;

DROP POLICY IF EXISTS "Active users can view audit summaries" ON public.audit_log;
DROP POLICY IF EXISTS "Admins and editors can view audit log" ON public.audit_log;
CREATE POLICY "Admins and editors can view audit log"
ON public.audit_log
FOR SELECT
TO authenticated
USING (public.is_admin() OR public.is_editor());

CREATE OR REPLACE FUNCTION public.write_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  private_old_data jsonb;
  private_new_data jsonb;
BEGIN
  IF tg_table_schema <> 'public'
    OR tg_table_name NOT IN ('persons', 'relationships', 'custom_events', 'gallery_items', 'profiles', 'person_details_private') THEN
    RAISE EXCEPTION 'Unsupported audit trigger source: %.%', tg_table_schema, tg_table_name;
  END IF;

  IF tg_table_name = 'person_details_private' THEN
    IF tg_op = 'INSERT' THEN
      SELECT jsonb_build_object(
        'redacted', true,
        'changed_fields', coalesce(jsonb_agg(field_name ORDER BY field_name), '[]'::jsonb)
      )
      INTO private_new_data
      FROM jsonb_object_keys(to_jsonb(new)) AS fields(field_name)
      WHERE field_name NOT IN ('created_at', 'updated_at');
    ELSIF tg_op = 'UPDATE' THEN
      SELECT jsonb_build_object(
        'redacted', true,
        'changed_fields', coalesce(jsonb_agg(field_name ORDER BY field_name), '[]'::jsonb)
      )
      INTO private_new_data
      FROM jsonb_object_keys(to_jsonb(new)) AS fields(field_name)
      WHERE field_name NOT IN ('created_at', 'updated_at')
        AND (to_jsonb(old) -> field_name) IS DISTINCT FROM (to_jsonb(new) -> field_name);
      private_old_data := jsonb_build_object('redacted', true);
    ELSE
      SELECT jsonb_build_object(
        'redacted', true,
        'changed_fields', coalesce(jsonb_agg(field_name ORDER BY field_name), '[]'::jsonb)
      )
      INTO private_old_data
      FROM jsonb_object_keys(to_jsonb(old)) AS fields(field_name)
      WHERE field_name NOT IN ('created_at', 'updated_at');
    END IF;

    INSERT INTO public.audit_log (table_name, record_id, operation, actor_user_id, old_data, new_data)
    VALUES (
      tg_table_name,
      coalesce(new.person_id, old.person_id),
      tg_op,
      auth.uid(),
      private_old_data,
      private_new_data
    );
  ELSE
    INSERT INTO public.audit_log (table_name, record_id, operation, actor_user_id, old_data, new_data)
    VALUES (
      tg_table_name,
      coalesce(new.id, old.id),
      tg_op,
      auth.uid(),
      CASE WHEN tg_op IN ('UPDATE', 'DELETE') THEN to_jsonb(old) END,
      CASE WHEN tg_op IN ('INSERT', 'UPDATE') THEN to_jsonb(new) END
    );
  END IF;

  RETURN coalesce(new, old);
END;
$$;

REVOKE ALL ON FUNCTION public.write_audit_log() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_audit_log_truncation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Audit log cannot be truncated.';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_audit_log_truncation() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS tr_prevent_audit_log_truncate ON public.audit_log;
CREATE TRIGGER tr_prevent_audit_log_truncate
BEFORE TRUNCATE ON public.audit_log
FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_audit_log_truncation();

ALTER TABLE public.audit_log ENABLE ALWAYS TRIGGER tr_prevent_audit_log_truncate;

DROP TRIGGER IF EXISTS tr_audit_persons ON public.persons;
CREATE TRIGGER tr_audit_persons AFTER INSERT OR UPDATE OR DELETE ON public.persons FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

DROP TRIGGER IF EXISTS tr_audit_relationships ON public.relationships;
CREATE TRIGGER tr_audit_relationships AFTER INSERT OR UPDATE OR DELETE ON public.relationships FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

DROP TRIGGER IF EXISTS tr_audit_custom_events ON public.custom_events;
CREATE TRIGGER tr_audit_custom_events AFTER INSERT OR UPDATE OR DELETE ON public.custom_events FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

DROP TRIGGER IF EXISTS tr_audit_gallery_items ON public.gallery_items;
CREATE TRIGGER tr_audit_gallery_items AFTER INSERT OR UPDATE OR DELETE ON public.gallery_items FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

DROP TRIGGER IF EXISTS tr_audit_profiles ON public.profiles;
CREATE TRIGGER tr_audit_profiles AFTER INSERT OR UPDATE OR DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

DROP TRIGGER IF EXISTS tr_audit_person_details_private ON public.person_details_private;
CREATE TRIGGER tr_audit_person_details_private AFTER INSERT OR UPDATE OR DELETE ON public.person_details_private FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

+-- Safe undo RPC for recent audit log entries
alter table public.audit_log
  add column if not exists undone_audit_id bigint references public.audit_log(id) on delete set null;

create index if not exists audit_log_undone_audit_id_idx on public.audit_log(undone_audit_id);

create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  private_old_data jsonb;
  private_new_data jsonb;
  active_undone_audit_id bigint;
  undone_id_text text;
begin
  if tg_table_schema <> 'public'
    or tg_table_name not in ('persons', 'relationships', 'custom_events', 'gallery_items', 'profiles', 'person_details_private') then
    raise exception 'Unsupported audit trigger source: %.%', tg_table_schema, tg_table_name;
  end if;

  undone_id_text := current_setting('audit.undone_audit_id', true);
  if undone_id_text is not null and undone_id_text ~ '^\d+$' then
    active_undone_audit_id := undone_id_text::bigint;
  else
    active_undone_audit_id := null;
  end if;

  if tg_table_name = 'person_details_private' then
    if tg_op = 'INSERT' then
      select jsonb_build_object(
        'redacted', true,
        'changed_fields', coalesce(jsonb_agg(field_name order by field_name), '[]'::jsonb)
      )
      into private_new_data
      from jsonb_object_keys(to_jsonb(new)) as fields(field_name)
      where field_name not in ('created_at', 'updated_at');
    elsif tg_op = 'UPDATE' then
      select jsonb_build_object(
        'redacted', true,
        'changed_fields', coalesce(jsonb_agg(field_name order by field_name), '[]'::jsonb)
      )
      into private_new_data
      from jsonb_object_keys(to_jsonb(new)) as fields(field_name)
      where field_name not in ('created_at', 'updated_at')
        and (to_jsonb(old) -> field_name) is distinct from (to_jsonb(new) -> field_name);
      private_old_data := jsonb_build_object('redacted', true);
    else
      select jsonb_build_object(
        'redacted', true,
        'changed_fields', coalesce(jsonb_agg(field_name order by field_name), '[]'::jsonb)
      )
      into private_old_data
      from jsonb_object_keys(to_jsonb(old)) as fields(field_name)
      where field_name not in ('created_at', 'updated_at');
    end if;

    insert into public.audit_log (table_name, record_id, operation, actor_user_id, old_data, new_data, undone_audit_id)
    values (
      tg_table_name,
      coalesce(new.person_id, old.person_id),
      tg_op,
      auth.uid(),
      private_old_data,
      private_new_data,
      active_undone_audit_id
    );
  else
    insert into public.audit_log (table_name, record_id, operation, actor_user_id, old_data, new_data, undone_audit_id)
    values (
      tg_table_name,
      coalesce(new.id, old.id),
      tg_op,
      auth.uid(),
      case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
      case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
      active_undone_audit_id
    );
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function public.write_audit_log() from public, anon, authenticated;

create or replace function public.undo_audit_entry(audit_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry record;
  is_admin_user boolean := false;
  is_editor_user boolean := false;
  current_row_json jsonb;
  expected_row_json jsonb;
  target_person public.persons%rowtype;
  target_rel public.relationships%rowtype;
  target_evt public.custom_events%rowtype;
  target_gallery public.gallery_items%rowtype;
  affected_table text;
  affected_id uuid;
  affected_op text;
begin
  if audit_id is null or audit_id <= 0 then
    raise exception 'Invalid audit id.';
  end if;

  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active = true
  ) into is_admin_user;

  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'editor' and is_active = true
  ) into is_editor_user;

  if not (is_admin_user or is_editor_user) then
    raise exception 'Access denied.';
  end if;

  select *
  into entry
  from public.audit_log
  where id = audit_id
  for update;

  if not found then
    raise exception 'Audit entry not found.';
  end if;

  if entry.occurred_at < now() - interval '24 hours' then
    raise exception 'Undo window has expired.';
  end if;

  if exists (
    select 1 from public.audit_log
    where undone_audit_id = entry.id
  ) then
    raise exception 'Audit entry has already been undone.';
  end if;

  affected_table := entry.table_name;
  affected_id := entry.record_id;
  affected_op := entry.operation;

  if not (
    (affected_table = 'persons' and affected_op = 'UPDATE')
    or (affected_table = 'relationships' and affected_op in ('INSERT', 'DELETE'))
    or (affected_table = 'custom_events' and affected_op in ('INSERT', 'UPDATE', 'DELETE'))
    or (affected_table = 'gallery_items' and affected_op = 'UPDATE')
  ) then
    raise exception 'Undo is not supported for this change type.';
  end if;

  if affected_table = 'gallery_items' and not is_admin_user then
    raise exception 'Access denied.';
  end if;

  if affected_table = 'gallery_items' and exists (
    select 1
    from jsonb_object_keys(entry.new_data) as fields(field_name)
    where (entry.old_data -> field_name) is distinct from (entry.new_data -> field_name)
      and field_name not in ('title', 'description', 'event_date')
  ) then
    raise exception 'Undo is not supported for gallery storage or ownership changes.';
  end if;

  perform set_config('audit.undone_audit_id', entry.id::text, true);

  if affected_table = 'persons' and affected_op = 'UPDATE' then
    select * into target_person from public.persons where id = affected_id for update;
    if not found then
      raise exception 'Conflict detected: target record no longer exists.';
    end if;

    current_row_json := to_jsonb(target_person);
    expected_row_json := entry.new_data;

    if current_row_json is distinct from expected_row_json then
      raise exception 'Conflict detected: person no longer matches the audited state.';
    end if;

    update public.persons
    set
      full_name = coalesce((entry.old_data->>'full_name'), full_name),
      gender = (entry.old_data->>'gender')::public.gender_enum,
      birth_year = case when entry.old_data ? 'birth_year' then (entry.old_data->>'birth_year')::int else birth_year end,
      birth_month = case when entry.old_data ? 'birth_month' then (entry.old_data->>'birth_month')::int else birth_month end,
      birth_day = case when entry.old_data ? 'birth_day' then (entry.old_data->>'birth_day')::int else birth_day end,
      death_year = case when entry.old_data ? 'death_year' then (entry.old_data->>'death_year')::int else death_year end,
      death_month = case when entry.old_data ? 'death_month' then (entry.old_data->>'death_month')::int else death_month end,
      death_day = case when entry.old_data ? 'death_day' then (entry.old_data->>'death_day')::int else death_day end,
      death_lunar_year = case when entry.old_data ? 'death_lunar_year' then (entry.old_data->>'death_lunar_year')::int else death_lunar_year end,
      death_lunar_month = case when entry.old_data ? 'death_lunar_month' then (entry.old_data->>'death_lunar_month')::int else death_lunar_month end,
      death_lunar_day = case when entry.old_data ? 'death_lunar_day' then (entry.old_data->>'death_lunar_day')::int else death_lunar_day end,
      is_deceased = coalesce((entry.old_data->>'is_deceased')::boolean, is_deceased),
      is_in_law = coalesce((entry.old_data->>'is_in_law')::boolean, is_in_law),
      birth_order = case when entry.old_data ? 'birth_order' then (entry.old_data->>'birth_order')::int else birth_order end,
      generation = case when entry.old_data ? 'generation' then (entry.old_data->>'generation')::int else generation end,
      other_names = case when entry.old_data ? 'other_names' then entry.old_data->>'other_names' else other_names end,
      avatar_url = case when entry.old_data ? 'avatar_url' then entry.old_data->>'avatar_url' else avatar_url end,
      note = case when entry.old_data ? 'note' then entry.old_data->>'note' else note end
    where id = affected_id;

  elsif affected_table = 'relationships' and affected_op = 'INSERT' then
    select * into target_rel from public.relationships where id = affected_id for update;
    if not found then
      raise exception 'Conflict detected: relationship already deleted.';
    end if;

    current_row_json := to_jsonb(target_rel);
    expected_row_json := entry.new_data;
    if current_row_json is distinct from expected_row_json then
      raise exception 'Conflict detected: relationship no longer matches the audited state.';
    end if;

    delete from public.relationships where id = affected_id;

  elsif affected_table = 'relationships' and affected_op = 'DELETE' then
    if exists (select 1 from public.relationships where id = affected_id) then
      raise exception 'Conflict detected: relationship with this id already exists.';
    end if;

    if not exists (select 1 from public.persons where id = (entry.old_data->>'person_a')::uuid)
       or not exists (select 1 from public.persons where id = (entry.old_data->>'person_b')::uuid) then
      raise exception 'Conflict detected: related person no longer exists.';
    end if;

    insert into public.relationships (id, type, person_a, person_b, note, created_at, updated_at)
    values (
      affected_id,
      (entry.old_data->>'type')::public.relationship_type_enum,
      (entry.old_data->>'person_a')::uuid,
      (entry.old_data->>'person_b')::uuid,
      entry.old_data->>'note',
      (entry.old_data->>'created_at')::timestamptz,
      (entry.old_data->>'updated_at')::timestamptz
    );

  elsif affected_table = 'custom_events' and affected_op = 'INSERT' then
    select * into target_evt from public.custom_events where id = affected_id for update;
    if not found then
      raise exception 'Conflict detected: custom event already removed.';
    end if;

    current_row_json := to_jsonb(target_evt);
    expected_row_json := entry.new_data;
    if current_row_json is distinct from expected_row_json then
      raise exception 'Conflict detected: custom event no longer matches the audited state.';
    end if;

    delete from public.custom_events where id = affected_id;

  elsif affected_table = 'custom_events' and affected_op = 'UPDATE' then
    select * into target_evt from public.custom_events where id = affected_id for update;
    if not found then
      raise exception 'Conflict detected: custom event does not exist.';
    end if;

    current_row_json := to_jsonb(target_evt);
    expected_row_json := entry.new_data;
    if current_row_json is distinct from expected_row_json then
      raise exception 'Conflict detected: custom event no longer matches the audited state.';
    end if;

    update public.custom_events
    set
      name = coalesce(entry.old_data->>'name', name),
      content = case when entry.old_data ? 'content' then entry.old_data->>'content' else content end,
      event_date = coalesce((entry.old_data->>'event_date')::date, event_date),
      location = case when entry.old_data ? 'location' then entry.old_data->>'location' else location end,
      created_by = case when entry.old_data ? 'created_by' then (entry.old_data->>'created_by')::uuid else created_by end
    where id = affected_id;

  elsif affected_table = 'custom_events' and affected_op = 'DELETE' then
    if exists (select 1 from public.custom_events where id = affected_id) then
      raise exception 'Conflict detected: custom event already exists.';
    end if;

    insert into public.custom_events (id, name, content, event_date, location, created_by, created_at, updated_at)
    values (
      affected_id,
      entry.old_data->>'name',
      entry.old_data->>'content',
      (entry.old_data->>'event_date')::date,
      entry.old_data->>'location',
      coalesce((entry.old_data->>'created_by')::uuid, auth.uid()),
      (entry.old_data->>'created_at')::timestamptz,
      (entry.old_data->>'updated_at')::timestamptz
    );

  elsif affected_table = 'gallery_items' and affected_op = 'UPDATE' then
    select * into target_gallery from public.gallery_items where id = affected_id for update;
    if not found then
      raise exception 'Conflict detected: gallery item does not exist.';
    end if;

    current_row_json := to_jsonb(target_gallery);
    expected_row_json := entry.new_data;

    if current_row_json is distinct from expected_row_json then
      raise exception 'Conflict detected: gallery item no longer matches the audited state.';
    end if;

    -- Metadata update ONLY: never modify image_url or storage
    update public.gallery_items
    set
      title = coalesce(entry.old_data->>'title', title),
      description = case when entry.old_data ? 'description' then entry.old_data->>'description' else description end,
      event_date = case when entry.old_data ? 'event_date' then (entry.old_data->>'event_date')::date else event_date end
    where id = affected_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'undone_audit_id', entry.id,
    'table_name', affected_table,
    'record_id', affected_id,
    'operation', affected_op
  );
end;
$$;

revoke all on function public.undo_audit_entry(bigint) from public, anon, authenticated;
grant execute on function public.undo_audit_entry(bigint) to authenticated;


-- ========================================================
-- 12. SOURCES & CITATIONS MODULE
-- ========================================================

CREATE TABLE IF NOT EXISTS public.sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  source_type TEXT NOT NULL,
  author TEXT,
  publisher TEXT,
  publication_date DATE,
  url TEXT,
  repository TEXT,
  note TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sources_title_chk CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT sources_source_type_chk CHECK (source_type IN ('document', 'book', 'oral_history', 'website', 'photo', 'other')),
  CONSTRAINT sources_author_length_chk CHECK (author IS NULL OR char_length(author) <= 300),
  CONSTRAINT sources_publisher_length_chk CHECK (publisher IS NULL OR char_length(publisher) <= 300),
  CONSTRAINT sources_url_length_chk CHECK (url IS NULL OR char_length(url) <= 2048),
  CONSTRAINT sources_url_protocol_chk CHECK (url IS NULL OR url ~* '^https?://[^[:space:]]+$'),
  CONSTRAINT sources_repository_length_chk CHECK (repository IS NULL OR char_length(repository) <= 500),
  CONSTRAINT sources_note_length_chk CHECK (note IS NULL OR char_length(note) <= 5000)
);

CREATE TABLE IF NOT EXISTS public.person_citations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES public.sources(id) ON DELETE CASCADE,
  field_name TEXT,
  page_reference TEXT,
  quotation TEXT,
  confidence TEXT NOT NULL DEFAULT 'uncertain',
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT person_citations_field_name_chk CHECK (field_name IS NULL OR field_name IN ('birth_date', 'death_date', 'relationship', 'note', 'other')),
  CONSTRAINT person_citations_page_reference_length_chk CHECK (page_reference IS NULL OR char_length(page_reference) <= 300),
  CONSTRAINT person_citations_quotation_length_chk CHECK (quotation IS NULL OR char_length(quotation) <= 5000),
  CONSTRAINT person_citations_confidence_chk CHECK (confidence IN ('primary', 'secondary', 'uncertain'))
);

CREATE INDEX IF NOT EXISTS idx_sources_title ON public.sources(title);
CREATE INDEX IF NOT EXISTS idx_sources_type ON public.sources(source_type);
CREATE INDEX IF NOT EXISTS idx_person_citations_person_id ON public.person_citations(person_id);
CREATE INDEX IF NOT EXISTS idx_person_citations_source_id ON public.person_citations(source_id);
CREATE UNIQUE INDEX IF NOT EXISTS person_citations_identical_uidx
  ON public.person_citations (
    person_id,
    source_id,
    coalesce(field_name, ''),
    coalesce(page_reference, ''),
    coalesce(quotation, ''),
    confidence
  );

DROP TRIGGER IF EXISTS tr_sources_updated_at ON public.sources;
CREATE TRIGGER tr_sources_updated_at BEFORE UPDATE ON public.sources FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_citations ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.prevent_source_owner_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.created_by IS DISTINCT FROM OLD.created_by AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can change a source owner.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_source_owner_change() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_citation_owner_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.created_by IS DISTINCT FROM OLD.created_by AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can change a citation owner.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_citation_owner_change() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS prevent_source_owner_change_trigger ON public.sources;
CREATE TRIGGER prevent_source_owner_change_trigger BEFORE UPDATE OF created_by ON public.sources FOR EACH ROW EXECUTE FUNCTION public.prevent_source_owner_change();
DROP TRIGGER IF EXISTS prevent_citation_owner_change_trigger ON public.person_citations;
CREATE TRIGGER prevent_citation_owner_change_trigger BEFORE UPDATE OF created_by ON public.person_citations FOR EACH ROW EXECUTE FUNCTION public.prevent_citation_owner_change();

REVOKE ALL ON TABLE public.sources FROM public, anon;
REVOKE ALL ON TABLE public.person_citations FROM public, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sources TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.person_citations TO authenticated;

DROP POLICY IF EXISTS "Active users can read sources" ON public.sources;
CREATE POLICY "Active users can read sources" ON public.sources FOR SELECT TO authenticated USING (public.is_active_user());
DROP POLICY IF EXISTS "Admins and editors can insert sources" ON public.sources;
CREATE POLICY "Admins and editors can insert sources" ON public.sources FOR INSERT TO authenticated WITH CHECK ((public.is_admin() OR public.is_editor()) AND auth.uid() = created_by);
DROP POLICY IF EXISTS "Admins and editors can update sources" ON public.sources;
CREATE POLICY "Admins and editors can update sources" ON public.sources FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_editor()) WITH CHECK (public.is_admin() OR public.is_editor());
DROP POLICY IF EXISTS "Admins and editors can delete sources" ON public.sources;
CREATE POLICY "Admins and editors can delete sources" ON public.sources FOR DELETE TO authenticated USING (public.is_admin() OR public.is_editor());

DROP POLICY IF EXISTS "Active users can read person citations" ON public.person_citations;
CREATE POLICY "Active users can read person citations" ON public.person_citations FOR SELECT TO authenticated USING (public.can_view_person(person_id));
DROP POLICY IF EXISTS "Admins and editors can insert person citations" ON public.person_citations;
CREATE POLICY "Admins and editors can insert person citations" ON public.person_citations FOR INSERT TO authenticated WITH CHECK ((public.is_admin() OR public.is_editor()) AND auth.uid() = created_by);
DROP POLICY IF EXISTS "Admins and editors can update person citations" ON public.person_citations;
CREATE POLICY "Admins and editors can update person citations" ON public.person_citations FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_editor()) WITH CHECK (public.is_admin() OR public.is_editor());
DROP POLICY IF EXISTS "Admins and editors can delete person citations" ON public.person_citations;
CREATE POLICY "Admins and editors can delete person citations" ON public.person_citations FOR DELETE TO authenticated USING (public.is_admin() OR public.is_editor());
-- Duplicate detection and controlled merge (20260903120000)
create extension if not exists unaccent with schema extensions;
create or replace function public.normalize_duplicate_name(input text) returns text;
create index if not exists persons_duplicate_normalized_name_idx on public.persons (public.normalize_duplicate_name(full_name));
alter table public.custom_events add column if not exists person_id uuid references public.persons(id) on delete set null;
alter table public.gallery_items add column if not exists person_id uuid references public.persons(id) on delete set null;
create or replace function public.find_duplicate_candidates(candidate_limit integer default 25, candidate_offset integer default 0) returns table (primary_person jsonb, duplicate_person jsonb);
create or replace function public.merge_person_records(primary_id uuid, duplicate_id uuid, resolution jsonb) returns uuid;

-- Member contribution review (20260903140000)
create table if not exists public.change_requests (
  id uuid primary key default gen_random_uuid(),
  target_table text not null check (target_table in ('persons', 'custom_events', 'sources', 'person_citations')),
  target_id uuid not null,
  operation text not null check (operation in ('INSERT', 'UPDATE')),
  proposed_data jsonb not null check (jsonb_typeof(proposed_data) = 'object' and proposed_data <> '{}'::jsonb),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  requester_id uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  reviewer_id uuid references public.profiles(id) on delete set null,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  withdrawn_at timestamptz
);
create index if not exists change_requests_requester_created_idx on public.change_requests (requester_id, created_at desc);
create index if not exists change_requests_review_queue_idx on public.change_requests (status, created_at) where status = 'pending';
alter table public.change_requests enable row level security;
create policy "Requesters can read own change requests" on public.change_requests for select to authenticated using (public.is_active_user() and requester_id = auth.uid());
create policy "Admins and editors can review change requests" on public.change_requests for select to authenticated using (public.is_admin() or public.is_editor());
create or replace function public.submit_change_request(target_table text, target_id uuid, operation text, proposed_data jsonb) returns uuid;
create or replace function public.approve_change_request(request_id uuid, note text default null) returns uuid;
create or replace function public.reject_change_request(request_id uuid, note text) returns uuid;
create or replace function public.withdraw_change_request(request_id uuid) returns uuid;


-- ==========================================
-- FAMILY TREE TOPOLOGY RPC & GALLERY STORAGE
-- ==========================================

DROP POLICY IF EXISTS "Gallery images are publicly accessible." ON storage.objects;
DROP POLICY IF EXISTS "Active users can view gallery objects" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view visible gallery objects" ON storage.objects;
CREATE POLICY "Authenticated users can view visible gallery objects"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'gallery'
  and exists (
      SELECT 1
      FROM public.gallery_items item
      WHERE public.is_active_user()
        AND (item.person_id IS NULL OR public.can_view_person(item.person_id))
        AND (item.image_url = name OR item.image_url LIKE '%/gallery/' || name)
  )
);

CREATE OR REPLACE FUNCTION public.get_family_tree_topology()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH relationship_access AS (
    SELECT
      relationship.id,
      relationship.type,
      relationship.person_a,
      relationship.person_b,
      relationship.note,
      public.can_view_person(relationship.person_a) AS can_view_a,
      public.can_view_person(relationship.person_b) AS can_view_b
    FROM public.relationships relationship
    WHERE public.is_active_user()
      AND (
        public.can_view_person(relationship.person_a)
        OR public.can_view_person(relationship.person_b)
      )
  ),
  visible_nodes AS (
    SELECT jsonb_build_object(
      'id', person.id::text,
      'full_name', person.full_name,
      'gender', person.gender,
      'birth_year', person.birth_year,
      'death_year', person.death_year,
      'death_lunar_year', person.death_lunar_year,
      'avatar_url', person.avatar_url,
      'updated_at', person.updated_at,
      'is_deceased', person.is_deceased,
      'is_in_law', person.is_in_law,
      'birth_order', person.birth_order,
      'generation', person.generation,
      'is_private_placeholder', false
    ) AS node
    FROM public.persons person
    WHERE public.can_view_person(person.id)
  ),
  hidden_endpoints AS (
    SELECT person_a AS person_id FROM relationship_access WHERE NOT can_view_a
    UNION
    SELECT person_b AS person_id FROM relationship_access WHERE NOT can_view_b
  ),
  hidden_nodes AS (
    SELECT jsonb_build_object(
      'id', 'private:' || md5(endpoint.person_id::text || ':' || auth.uid()::text),
      'full_name', 'Thành viên riêng tư',
      'gender', 'other',
      'birth_year', null,
      'death_year', null,
      'death_lunar_year', null,
      'avatar_url', null,
      'updated_at', null,
      'is_deceased', false,
      'is_in_law', false,
      'birth_order', null,
      'generation', null,
      'is_private_placeholder', true
    ) AS node
    FROM hidden_endpoints endpoint
  ),
  topology_edges AS (
    SELECT jsonb_build_object(
      'id', 'relationship:' || md5(access.id::text || ':' || auth.uid()::text),
      'type', access.type,
      'person_a', CASE
        WHEN access.can_view_a THEN access.person_a::text
        ELSE 'private:' || md5(access.person_a::text || ':' || auth.uid()::text)
      END,
      'person_b', CASE
        WHEN access.can_view_b THEN access.person_b::text
        ELSE 'private:' || md5(access.person_b::text || ':' || auth.uid()::text)
      END,
      'note', CASE WHEN access.can_view_a AND access.can_view_b THEN access.note ELSE null END,
      'created_at', null,
      'updated_at', null
    ) AS edge
    FROM relationship_access access
  )
  SELECT jsonb_build_object(
    'persons', COALESCE(
      (SELECT jsonb_agg(nodes.node ORDER BY nodes.node ->> 'id') FROM (
        SELECT node FROM visible_nodes
        UNION ALL
        SELECT node FROM hidden_nodes
      ) nodes),
      '[]'::jsonb
    ),
    'relationships', COALESCE(
      (SELECT jsonb_agg(topology_edges.edge ORDER BY topology_edges.edge ->> 'id') FROM topology_edges),
      '[]'::jsonb
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_family_tree_topology() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_family_tree_topology() TO authenticated;
)
      or (
        item.payload ->> 'person_id' is not null
        and not exists (
          select 1 from restore_persons person
          where person.payload ->> 'id' = item.payload ->> 'person_id'
        )
      )
  ) or exists (
    select 1 from restore_gallery_items group by payload ->> 'id' having count(*) > 1
  ) then
    raise exception 'Invalid gallery item in backup payload.';
  end if;

  delete from public.gallery_items;
  delete from public.person_citations;
  delete from public.sources;
  delete from public.custom_events;
  delete from public.relationships;
  delete from public.person_details_private;
  delete from public.persons;

  insert into public.persons (id, full_name, gender, birth_year, birth_month, birth_day, death_year, death_month, death_day, death_lunar_year, death_lunar_month, death_lunar_day, is_deceased, is_in_law, birth_order, generation, other_names, avatar_url, note, privacy_level)
  select (payload ->> 'id')::uuid, payload ->> 'full_name', (payload ->> 'gender')::public.gender_enum, (payload ->> 'birth_year')::integer, (payload ->> 'birth_month')::integer, (payload ->> 'birth_day')::integer, (payload ->> 'death_year')::integer, (payload ->> 'death_month')::integer, (payload ->> 'death_day')::integer, (payload ->> 'death_lunar_year')::integer, (payload ->> 'death_lunar_month')::integer, (payload ->> 'death_lunar_day')::integer, coalesce((payload ->> 'is_deceased')::boolean, false), coalesce((payload ->> 'is_in_law')::boolean, false), (payload ->> 'birth_order')::integer, (payload ->> 'generation')::integer, payload ->> 'other_names', payload ->> 'avatar_url', payload ->> 'note', coalesce(payload ->> 'privacy_level', 'family') from restore_persons;
  insert into public.person_details_private (person_id, phone_number, occupation, current_residence)
  select (payload ->> 'person_id')::uuid, payload ->> 'phone_number', payload ->> 'occupation', payload ->> 'current_residence' from restore_private_details;
  insert into public.relationships (type, person_a, person_b, note)
  select (payload ->> 'type')::public.relationship_type_enum, (payload ->> 'person_a')::uuid, (payload ->> 'person_b')::uuid, payload ->> 'note' from restore_relationships;
  insert into public.custom_events (id, name, content, event_date, location, created_by, person_id)
  select (payload ->> 'id')::uuid, payload ->> 'name', payload ->> 'content', (payload ->> 'event_date')::date, payload ->> 'location', caller_id, (payload ->> 'person_id')::uuid from restore_events;
  insert into public.sources (id, title, source_type, author, publisher, publication_date, url, repository, note, created_by)
  select (payload ->> 'id')::uuid, payload ->> 'title', payload ->> 'source_type', payload ->> 'author', payload ->> 'publisher', (payload ->> 'publication_date')::date, payload ->> 'url', payload ->> 'repository', payload ->> 'note', caller_id from restore_sources;
  insert into public.person_citations (id, person_id, source_id, field_name, page_reference, quotation, confidence, created_by)
  select (payload ->> 'id')::uuid, (payload ->> 'person_id')::uuid, (payload ->> 'source_id')::uuid, payload ->> 'field_name', payload ->> 'page_reference', payload ->> 'quotation', payload ->> 'confidence', caller_id from restore_person_citations;
  insert into public.gallery_items (id, title, description, image_url, event_date, created_by, person_id)
  select (payload ->> 'id')::uuid, payload ->> 'title', payload ->> 'description', payload ->> 'image_url', (payload ->> 'event_date')::date, caller_id, (payload ->> 'person_id')::uuid from restore_gallery_items;

  if import_payload ->> 'version' = '3' then
    return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count);
  end if;

  if import_payload ->> 'version' = '4' then
    return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count, 'sources', sources_count, 'person_citations', citations_count);
  end if;

  return jsonb_build_object('persons', persons_count, 'relationships', relationships_count, 'person_details_private', private_details_count, 'custom_events', events_count, 'sources', sources_count, 'person_citations', citations_count, 'gallery_items', gallery_items_count);
end;
$$;

revoke all on function public.restore_backup(jsonb) from public, anon;
grant execute on function public.restore_backup(jsonb) to authenticated;

-- ========================================================
-- 11. AUDIT LOG MODULE
-- ========================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  table_name text NOT NULL CHECK (table_name IN ('persons', 'relationships', 'custom_events', 'gallery_items', 'profiles', 'person_details_private')),
  record_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  actor_user_id uuid,
  old_data jsonb,
  new_data jsonb
);

CREATE INDEX IF NOT EXISTS audit_log_occurred_at_id_idx ON public.audit_log (occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_log_record_id_idx ON public.audit_log (record_id);
CREATE INDEX IF NOT EXISTS audit_log_actor_user_id_idx ON public.audit_log (actor_user_id);
CREATE INDEX IF NOT EXISTS audit_log_table_name_occurred_at_idx ON public.audit_log (table_name, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_log_operation_occurred_at_idx ON public.audit_log (operation, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_user_id_occurred_at_idx ON public.audit_log (actor_user_id, occurred_at DESC, id DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.audit_log FROM public, anon, authenticated;
GRANT SELECT ON public.audit_log TO authenticated;

DROP POLICY IF EXISTS "Active users can view audit summaries" ON public.audit_log;
DROP POLICY IF EXISTS "Admins and editors can view audit log" ON public.audit_log;
CREATE POLICY "Admins and editors can view audit log"
ON public.audit_log
FOR SELECT
TO authenticated
USING (public.is_admin() OR public.is_editor());

CREATE OR REPLACE FUNCTION public.write_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  private_old_data jsonb;
  private_new_data jsonb;
BEGIN
  IF tg_table_schema <> 'public'
    OR tg_table_name NOT IN ('persons', 'relationships', 'custom_events', 'gallery_items', 'profiles', 'person_details_private') THEN
    RAISE EXCEPTION 'Unsupported audit trigger source: %.%', tg_table_schema, tg_table_name;
  END IF;

  IF tg_table_name = 'person_details_private' THEN
    IF tg_op = 'INSERT' THEN
      SELECT jsonb_build_object(
        'redacted', true,
        'changed_fields', coalesce(jsonb_agg(field_name ORDER BY field_name), '[]'::jsonb)
      )
      INTO private_new_data
      FROM jsonb_object_keys(to_jsonb(new)) AS fields(field_name)
      WHERE field_name NOT IN ('created_at', 'updated_at');
    ELSIF tg_op = 'UPDATE' THEN
      SELECT jsonb_build_object(
        'redacted', true,
        'changed_fields', coalesce(jsonb_agg(field_name ORDER BY field_name), '[]'::jsonb)
      )
      INTO private_new_data
      FROM jsonb_object_keys(to_jsonb(new)) AS fields(field_name)
      WHERE field_name NOT IN ('created_at', 'updated_at')
        AND (to_jsonb(old) -> field_name) IS DISTINCT FROM (to_jsonb(new) -> field_name);
      private_old_data := jsonb_build_object('redacted', true);
    ELSE
      SELECT jsonb_build_object(
        'redacted', true,
        'changed_fields', coalesce(jsonb_agg(field_name ORDER BY field_name), '[]'::jsonb)
      )
      INTO private_old_data
      FROM jsonb_object_keys(to_jsonb(old)) AS fields(field_name)
      WHERE field_name NOT IN ('created_at', 'updated_at');
    END IF;

    INSERT INTO public.audit_log (table_name, record_id, operation, actor_user_id, old_data, new_data)
    VALUES (
      tg_table_name,
      coalesce(new.person_id, old.person_id),
      tg_op,
      auth.uid(),
      private_old_data,
      private_new_data
    );
  ELSE
    INSERT INTO public.audit_log (table_name, record_id, operation, actor_user_id, old_data, new_data)
    VALUES (
      tg_table_name,
      coalesce(new.id, old.id),
      tg_op,
      auth.uid(),
      CASE WHEN tg_op IN ('UPDATE', 'DELETE') THEN to_jsonb(old) END,
      CASE WHEN tg_op IN ('INSERT', 'UPDATE') THEN to_jsonb(new) END
    );
  END IF;

  RETURN coalesce(new, old);
END;
$$;

REVOKE ALL ON FUNCTION public.write_audit_log() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_audit_log_truncation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Audit log cannot be truncated.';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_audit_log_truncation() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS tr_prevent_audit_log_truncate ON public.audit_log;
CREATE TRIGGER tr_prevent_audit_log_truncate
BEFORE TRUNCATE ON public.audit_log
FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_audit_log_truncation();

ALTER TABLE public.audit_log ENABLE ALWAYS TRIGGER tr_prevent_audit_log_truncate;

DROP TRIGGER IF EXISTS tr_audit_persons ON public.persons;
CREATE TRIGGER tr_audit_persons AFTER INSERT OR UPDATE OR DELETE ON public.persons FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

DROP TRIGGER IF EXISTS tr_audit_relationships ON public.relationships;
CREATE TRIGGER tr_audit_relationships AFTER INSERT OR UPDATE OR DELETE ON public.relationships FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

DROP TRIGGER IF EXISTS tr_audit_custom_events ON public.custom_events;
CREATE TRIGGER tr_audit_custom_events AFTER INSERT OR UPDATE OR DELETE ON public.custom_events FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

DROP TRIGGER IF EXISTS tr_audit_gallery_items ON public.gallery_items;
CREATE TRIGGER tr_audit_gallery_items AFTER INSERT OR UPDATE OR DELETE ON public.gallery_items FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

DROP TRIGGER IF EXISTS tr_audit_profiles ON public.profiles;
CREATE TRIGGER tr_audit_profiles AFTER INSERT OR UPDATE OR DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

DROP TRIGGER IF EXISTS tr_audit_person_details_private ON public.person_details_private;
CREATE TRIGGER tr_audit_person_details_private AFTER INSERT OR UPDATE OR DELETE ON public.person_details_private FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

+-- Safe undo RPC for recent audit log entries
alter table public.audit_log
  add column if not exists undone_audit_id bigint references public.audit_log(id) on delete set null;

create index if not exists audit_log_undone_audit_id_idx on public.audit_log(undone_audit_id);

create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  private_old_data jsonb;
  private_new_data jsonb;
  active_undone_audit_id bigint;
  undone_id_text text;
begin
  if tg_table_schema <> 'public'
    or tg_table_name not in ('persons', 'relationships', 'custom_events', 'gallery_items', 'profiles', 'person_details_private') then
    raise exception 'Unsupported audit trigger source: %.%', tg_table_schema, tg_table_name;
  end if;

  undone_id_text := current_setting('audit.undone_audit_id', true);
  if undone_id_text is not null and undone_id_text ~ '^\d+$' then
    active_undone_audit_id := undone_id_text::bigint;
  else
    active_undone_audit_id := null;
  end if;

  if tg_table_name = 'person_details_private' then
    if tg_op = 'INSERT' then
      select jsonb_build_object(
        'redacted', true,
        'changed_fields', coalesce(jsonb_agg(field_name order by field_name), '[]'::jsonb)
      )
      into private_new_data
      from jsonb_object_keys(to_jsonb(new)) as fields(field_name)
      where field_name not in ('created_at', 'updated_at');
    elsif tg_op = 'UPDATE' then
      select jsonb_build_object(
        'redacted', true,
        'changed_fields', coalesce(jsonb_agg(field_name order by field_name), '[]'::jsonb)
      )
      into private_new_data
      from jsonb_object_keys(to_jsonb(new)) as fields(field_name)
      where field_name not in ('created_at', 'updated_at')
        and (to_jsonb(old) -> field_name) is distinct from (to_jsonb(new) -> field_name);
      private_old_data := jsonb_build_object('redacted', true);
    else
      select jsonb_build_object(
        'redacted', true,
        'changed_fields', coalesce(jsonb_agg(field_name order by field_name), '[]'::jsonb)
      )
      into private_old_data
      from jsonb_object_keys(to_jsonb(old)) as fields(field_name)
      where field_name not in ('created_at', 'updated_at');
    end if;

    insert into public.audit_log (table_name, record_id, operation, actor_user_id, old_data, new_data, undone_audit_id)
    values (
      tg_table_name,
      coalesce(new.person_id, old.person_id),
      tg_op,
      auth.uid(),
      private_old_data,
      private_new_data,
      active_undone_audit_id
    );
  else
    insert into public.audit_log (table_name, record_id, operation, actor_user_id, old_data, new_data, undone_audit_id)
    values (
      tg_table_name,
      coalesce(new.id, old.id),
      tg_op,
      auth.uid(),
      case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
      case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
      active_undone_audit_id
    );
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function public.write_audit_log() from public, anon, authenticated;

create or replace function public.undo_audit_entry(audit_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry record;
  is_admin_user boolean := false;
  is_editor_user boolean := false;
  current_row_json jsonb;
  expected_row_json jsonb;
  target_person public.persons%rowtype;
  target_rel public.relationships%rowtype;
  target_evt public.custom_events%rowtype;
  target_gallery public.gallery_items%rowtype;
  affected_table text;
  affected_id uuid;
  affected_op text;
begin
  if audit_id is null or audit_id <= 0 then
    raise exception 'Invalid audit id.';
  end if;

  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active = true
  ) into is_admin_user;

  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'editor' and is_active = true
  ) into is_editor_user;

  if not (is_admin_user or is_editor_user) then
    raise exception 'Access denied.';
  end if;

  select *
  into entry
  from public.audit_log
  where id = audit_id
  for update;

  if not found then
    raise exception 'Audit entry not found.';
  end if;

  if entry.occurred_at < now() - interval '24 hours' then
    raise exception 'Undo window has expired.';
  end if;

  if exists (
    select 1 from public.audit_log
    where undone_audit_id = entry.id
  ) then
    raise exception 'Audit entry has already been undone.';
  end if;

  affected_table := entry.table_name;
  affected_id := entry.record_id;
  affected_op := entry.operation;

  if not (
    (affected_table = 'persons' and affected_op = 'UPDATE')
    or (affected_table = 'relationships' and affected_op in ('INSERT', 'DELETE'))
    or (affected_table = 'custom_events' and affected_op in ('INSERT', 'UPDATE', 'DELETE'))
    or (affected_table = 'gallery_items' and affected_op = 'UPDATE')
  ) then
    raise exception 'Undo is not supported for this change type.';
  end if;

  if affected_table = 'gallery_items' and not is_admin_user then
    raise exception 'Access denied.';
  end if;

  if affected_table = 'gallery_items' and exists (
    select 1
    from jsonb_object_keys(entry.new_data) as fields(field_name)
    where (entry.old_data -> field_name) is distinct from (entry.new_data -> field_name)
      and field_name not in ('title', 'description', 'event_date')
  ) then
    raise exception 'Undo is not supported for gallery storage or ownership changes.';
  end if;

  perform set_config('audit.undone_audit_id', entry.id::text, true);

  if affected_table = 'persons' and affected_op = 'UPDATE' then
    select * into target_person from public.persons where id = affected_id for update;
    if not found then
      raise exception 'Conflict detected: target record no longer exists.';
    end if;

    current_row_json := to_jsonb(target_person);
    expected_row_json := entry.new_data;

    if current_row_json is distinct from expected_row_json then
      raise exception 'Conflict detected: person no longer matches the audited state.';
    end if;

    update public.persons
    set
      full_name = coalesce((entry.old_data->>'full_name'), full_name),
      gender = (entry.old_data->>'gender')::public.gender_enum,
      birth_year = case when entry.old_data ? 'birth_year' then (entry.old_data->>'birth_year')::int else birth_year end,
      birth_month = case when entry.old_data ? 'birth_month' then (entry.old_data->>'birth_month')::int else birth_month end,
      birth_day = case when entry.old_data ? 'birth_day' then (entry.old_data->>'birth_day')::int else birth_day end,
      death_year = case when entry.old_data ? 'death_year' then (entry.old_data->>'death_year')::int else death_year end,
      death_month = case when entry.old_data ? 'death_month' then (entry.old_data->>'death_month')::int else death_month end,
      death_day = case when entry.old_data ? 'death_day' then (entry.old_data->>'death_day')::int else death_day end,
      death_lunar_year = case when entry.old_data ? 'death_lunar_year' then (entry.old_data->>'death_lunar_year')::int else death_lunar_year end,
      death_lunar_month = case when entry.old_data ? 'death_lunar_month' then (entry.old_data->>'death_lunar_month')::int else death_lunar_month end,
      death_lunar_day = case when entry.old_data ? 'death_lunar_day' then (entry.old_data->>'death_lunar_day')::int else death_lunar_day end,
      is_deceased = coalesce((entry.old_data->>'is_deceased')::boolean, is_deceased),
      is_in_law = coalesce((entry.old_data->>'is_in_law')::boolean, is_in_law),
      birth_order = case when entry.old_data ? 'birth_order' then (entry.old_data->>'birth_order')::int else birth_order end,
      generation = case when entry.old_data ? 'generation' then (entry.old_data->>'generation')::int else generation end,
      other_names = case when entry.old_data ? 'other_names' then entry.old_data->>'other_names' else other_names end,
      avatar_url = case when entry.old_data ? 'avatar_url' then entry.old_data->>'avatar_url' else avatar_url end,
      note = case when entry.old_data ? 'note' then entry.old_data->>'note' else note end
    where id = affected_id;

  elsif affected_table = 'relationships' and affected_op = 'INSERT' then
    select * into target_rel from public.relationships where id = affected_id for update;
    if not found then
      raise exception 'Conflict detected: relationship already deleted.';
    end if;

    current_row_json := to_jsonb(target_rel);
    expected_row_json := entry.new_data;
    if current_row_json is distinct from expected_row_json then
      raise exception 'Conflict detected: relationship no longer matches the audited state.';
    end if;

    delete from public.relationships where id = affected_id;

  elsif affected_table = 'relationships' and affected_op = 'DELETE' then
    if exists (select 1 from public.relationships where id = affected_id) then
      raise exception 'Conflict detected: relationship with this id already exists.';
    end if;

    if not exists (select 1 from public.persons where id = (entry.old_data->>'person_a')::uuid)
       or not exists (select 1 from public.persons where id = (entry.old_data->>'person_b')::uuid) then
      raise exception 'Conflict detected: related person no longer exists.';
    end if;

    insert into public.relationships (id, type, person_a, person_b, note, created_at, updated_at)
    values (
      affected_id,
      (entry.old_data->>'type')::public.relationship_type_enum,
      (entry.old_data->>'person_a')::uuid,
      (entry.old_data->>'person_b')::uuid,
      entry.old_data->>'note',
      (entry.old_data->>'created_at')::timestamptz,
      (entry.old_data->>'updated_at')::timestamptz
    );

  elsif affected_table = 'custom_events' and affected_op = 'INSERT' then
    select * into target_evt from public.custom_events where id = affected_id for update;
    if not found then
      raise exception 'Conflict detected: custom event already removed.';
    end if;

    current_row_json := to_jsonb(target_evt);
    expected_row_json := entry.new_data;
    if current_row_json is distinct from expected_row_json then
      raise exception 'Conflict detected: custom event no longer matches the audited state.';
    end if;

    delete from public.custom_events where id = affected_id;

  elsif affected_table = 'custom_events' and affected_op = 'UPDATE' then
    select * into target_evt from public.custom_events where id = affected_id for update;
    if not found then
      raise exception 'Conflict detected: custom event does not exist.';
    end if;

    current_row_json := to_jsonb(target_evt);
    expected_row_json := entry.new_data;
    if current_row_json is distinct from expected_row_json then
      raise exception 'Conflict detected: custom event no longer matches the audited state.';
    end if;

    update public.custom_events
    set
      name = coalesce(entry.old_data->>'name', name),
      content = case when entry.old_data ? 'content' then entry.old_data->>'content' else content end,
      event_date = coalesce((entry.old_data->>'event_date')::date, event_date),
      location = case when entry.old_data ? 'location' then entry.old_data->>'location' else location end,
      created_by = case when entry.old_data ? 'created_by' then (entry.old_data->>'created_by')::uuid else created_by end
    where id = affected_id;

  elsif affected_table = 'custom_events' and affected_op = 'DELETE' then
    if exists (select 1 from public.custom_events where id = affected_id) then
      raise exception 'Conflict detected: custom event already exists.';
    end if;

    insert into public.custom_events (id, name, content, event_date, location, created_by, created_at, updated_at)
    values (
      affected_id,
      entry.old_data->>'name',
      entry.old_data->>'content',
      (entry.old_data->>'event_date')::date,
      entry.old_data->>'location',
      coalesce((entry.old_data->>'created_by')::uuid, auth.uid()),
      (entry.old_data->>'created_at')::timestamptz,
      (entry.old_data->>'updated_at')::timestamptz
    );

  elsif affected_table = 'gallery_items' and affected_op = 'UPDATE' then
    select * into target_gallery from public.gallery_items where id = affected_id for update;
    if not found then
      raise exception 'Conflict detected: gallery item does not exist.';
    end if;

    current_row_json := to_jsonb(target_gallery);
    expected_row_json := entry.new_data;

    if current_row_json is distinct from expected_row_json then
      raise exception 'Conflict detected: gallery item no longer matches the audited state.';
    end if;

    -- Metadata update ONLY: never modify image_url or storage
    update public.gallery_items
    set
      title = coalesce(entry.old_data->>'title', title),
      description = case when entry.old_data ? 'description' then entry.old_data->>'description' else description end,
      event_date = case when entry.old_data ? 'event_date' then (entry.old_data->>'event_date')::date else event_date end
    where id = affected_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'undone_audit_id', entry.id,
    'table_name', affected_table,
    'record_id', affected_id,
    'operation', affected_op
  );
end;
$$;

revoke all on function public.undo_audit_entry(bigint) from public, anon, authenticated;
grant execute on function public.undo_audit_entry(bigint) to authenticated;


-- ========================================================
-- 12. SOURCES & CITATIONS MODULE
-- ========================================================

CREATE TABLE IF NOT EXISTS public.sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  source_type TEXT NOT NULL,
  author TEXT,
  publisher TEXT,
  publication_date DATE,
  url TEXT,
  repository TEXT,
  note TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sources_title_chk CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT sources_source_type_chk CHECK (source_type IN ('document', 'book', 'oral_history', 'website', 'photo', 'other')),
  CONSTRAINT sources_author_length_chk CHECK (author IS NULL OR char_length(author) <= 300),
  CONSTRAINT sources_publisher_length_chk CHECK (publisher IS NULL OR char_length(publisher) <= 300),
  CONSTRAINT sources_url_length_chk CHECK (url IS NULL OR char_length(url) <= 2048),
  CONSTRAINT sources_url_protocol_chk CHECK (url IS NULL OR url ~* '^https?://[^[:space:]]+$'),
  CONSTRAINT sources_repository_length_chk CHECK (repository IS NULL OR char_length(repository) <= 500),
  CONSTRAINT sources_note_length_chk CHECK (note IS NULL OR char_length(note) <= 5000)
);

CREATE TABLE IF NOT EXISTS public.person_citations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES public.sources(id) ON DELETE CASCADE,
  field_name TEXT,
  page_reference TEXT,
  quotation TEXT,
  confidence TEXT NOT NULL DEFAULT 'uncertain',
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT person_citations_field_name_chk CHECK (field_name IS NULL OR field_name IN ('birth_date', 'death_date', 'relationship', 'note', 'other')),
  CONSTRAINT person_citations_page_reference_length_chk CHECK (page_reference IS NULL OR char_length(page_reference) <= 300),
  CONSTRAINT person_citations_quotation_length_chk CHECK (quotation IS NULL OR char_length(quotation) <= 5000),
  CONSTRAINT person_citations_confidence_chk CHECK (confidence IN ('primary', 'secondary', 'uncertain'))
);

CREATE INDEX IF NOT EXISTS idx_sources_title ON public.sources(title);
CREATE INDEX IF NOT EXISTS idx_sources_type ON public.sources(source_type);
CREATE INDEX IF NOT EXISTS idx_person_citations_person_id ON public.person_citations(person_id);
CREATE INDEX IF NOT EXISTS idx_person_citations_source_id ON public.person_citations(source_id);
CREATE UNIQUE INDEX IF NOT EXISTS person_citations_identical_uidx
  ON public.person_citations (
    person_id,
    source_id,
    coalesce(field_name, ''),
    coalesce(page_reference, ''),
    coalesce(quotation, ''),
    confidence
  );

DROP TRIGGER IF EXISTS tr_sources_updated_at ON public.sources;
CREATE TRIGGER tr_sources_updated_at BEFORE UPDATE ON public.sources FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_citations ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.prevent_source_owner_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.created_by IS DISTINCT FROM OLD.created_by AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can change a source owner.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_source_owner_change() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_citation_owner_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.created_by IS DISTINCT FROM OLD.created_by AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can change a citation owner.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_citation_owner_change() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS prevent_source_owner_change_trigger ON public.sources;
CREATE TRIGGER prevent_source_owner_change_trigger BEFORE UPDATE OF created_by ON public.sources FOR EACH ROW EXECUTE FUNCTION public.prevent_source_owner_change();
DROP TRIGGER IF EXISTS prevent_citation_owner_change_trigger ON public.person_citations;
CREATE TRIGGER prevent_citation_owner_change_trigger BEFORE UPDATE OF created_by ON public.person_citations FOR EACH ROW EXECUTE FUNCTION public.prevent_citation_owner_change();

REVOKE ALL ON TABLE public.sources FROM public, anon;
REVOKE ALL ON TABLE public.person_citations FROM public, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sources TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.person_citations TO authenticated;

DROP POLICY IF EXISTS "Active users can read sources" ON public.sources;
CREATE POLICY "Active users can read sources" ON public.sources FOR SELECT TO authenticated USING (public.is_active_user());
DROP POLICY IF EXISTS "Admins and editors can insert sources" ON public.sources;
CREATE POLICY "Admins and editors can insert sources" ON public.sources FOR INSERT TO authenticated WITH CHECK ((public.is_admin() OR public.is_editor()) AND auth.uid() = created_by);
DROP POLICY IF EXISTS "Admins and editors can update sources" ON public.sources;
CREATE POLICY "Admins and editors can update sources" ON public.sources FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_editor()) WITH CHECK (public.is_admin() OR public.is_editor());
DROP POLICY IF EXISTS "Admins and editors can delete sources" ON public.sources;
CREATE POLICY "Admins and editors can delete sources" ON public.sources FOR DELETE TO authenticated USING (public.is_admin() OR public.is_editor());

DROP POLICY IF EXISTS "Active users can read person citations" ON public.person_citations;
CREATE POLICY "Active users can read person citations" ON public.person_citations FOR SELECT TO authenticated USING (public.can_view_person(person_id));
DROP POLICY IF EXISTS "Admins and editors can insert person citations" ON public.person_citations;
CREATE POLICY "Admins and editors can insert person citations" ON public.person_citations FOR INSERT TO authenticated WITH CHECK ((public.is_admin() OR public.is_editor()) AND auth.uid() = created_by);
DROP POLICY IF EXISTS "Admins and editors can update person citations" ON public.person_citations;
CREATE POLICY "Admins and editors can update person citations" ON public.person_citations FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_editor()) WITH CHECK (public.is_admin() OR public.is_editor());
DROP POLICY IF EXISTS "Admins and editors can delete person citations" ON public.person_citations;
CREATE POLICY "Admins and editors can delete person citations" ON public.person_citations FOR DELETE TO authenticated USING (public.is_admin() OR public.is_editor());
-- Duplicate detection and controlled merge (20260903120000)
create extension if not exists unaccent with schema extensions;
create or replace function public.normalize_duplicate_name(input text) returns text;
create index if not exists persons_duplicate_normalized_name_idx on public.persons (public.normalize_duplicate_name(full_name));
alter table public.custom_events add column if not exists person_id uuid references public.persons(id) on delete set null;
alter table public.gallery_items add column if not exists person_id uuid references public.persons(id) on delete set null;
create or replace function public.find_duplicate_candidates(candidate_limit integer default 25, candidate_offset integer default 0) returns table (primary_person jsonb, duplicate_person jsonb);
create or replace function public.merge_person_records(primary_id uuid, duplicate_id uuid, resolution jsonb) returns uuid;

-- Member contribution review (20260903140000)
create table if not exists public.change_requests (
  id uuid primary key default gen_random_uuid(),
  target_table text not null check (target_table in ('persons', 'custom_events', 'sources', 'person_citations')),
  target_id uuid not null,
  operation text not null check (operation in ('INSERT', 'UPDATE')),
  proposed_data jsonb not null check (jsonb_typeof(proposed_data) = 'object' and proposed_data <> '{}'::jsonb),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  requester_id uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  reviewer_id uuid references public.profiles(id) on delete set null,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  withdrawn_at timestamptz
);
create index if not exists change_requests_requester_created_idx on public.change_requests (requester_id, created_at desc);
create index if not exists change_requests_review_queue_idx on public.change_requests (status, created_at) where status = 'pending';
alter table public.change_requests enable row level security;
create policy "Requesters can read own change requests" on public.change_requests for select to authenticated using (public.is_active_user() and requester_id = auth.uid());
create policy "Admins and editors can review change requests" on public.change_requests for select to authenticated using (public.is_admin() or public.is_editor());
create or replace function public.submit_change_request(target_table text, target_id uuid, operation text, proposed_data jsonb) returns uuid;
create or replace function public.approve_change_request(request_id uuid, note text default null) returns uuid;
create or replace function public.reject_change_request(request_id uuid, note text) returns uuid;
create or replace function public.withdraw_change_request(request_id uuid) returns uuid;


-- ==========================================
-- FAMILY TREE TOPOLOGY RPC & GALLERY STORAGE
-- ==========================================

DROP POLICY IF EXISTS "Gallery images are publicly accessible." ON storage.objects;
DROP POLICY IF EXISTS "Active users can view gallery objects" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view visible gallery objects" ON storage.objects;
CREATE POLICY "Authenticated users can view visible gallery objects"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'gallery'
  and exists (
      SELECT 1
      FROM public.gallery_items item
      WHERE public.is_active_user()
        AND (item.person_id IS NULL OR public.can_view_person(item.person_id))
        AND (item.image_url = name OR item.image_url LIKE '%/gallery/' || name)
  )
);

CREATE OR REPLACE FUNCTION public.get_family_tree_topology()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH relationship_access AS (
    SELECT
      relationship.id,
      relationship.type,
      relationship.person_a,
      relationship.person_b,
      relationship.note,
      public.can_view_person(relationship.person_a) AS can_view_a,
      public.can_view_person(relationship.person_b) AS can_view_b
    FROM public.relationships relationship
    WHERE public.is_active_user()
      AND (
        public.can_view_person(relationship.person_a)
        OR public.can_view_person(relationship.person_b)
      )
  ),
  visible_nodes AS (
    SELECT jsonb_build_object(
      'id', person.id::text,
      'full_name', person.full_name,
      'gender', person.gender,
      'birth_year', person.birth_year,
      'death_year', person.death_year,
      'death_lunar_year', person.death_lunar_year,
      'avatar_url', person.avatar_url,
      'updated_at', person.updated_at,
      'is_deceased', person.is_deceased,
      'is_in_law', person.is_in_law,
      'birth_order', person.birth_order,
      'generation', person.generation,
      'is_private_placeholder', false
    ) AS node
    FROM public.persons person
    WHERE public.can_view_person(person.id)
  ),
  hidden_endpoints AS (
    SELECT person_a AS person_id FROM relationship_access WHERE NOT can_view_a
    UNION
    SELECT person_b AS person_id FROM relationship_access WHERE NOT can_view_b
  ),
  hidden_nodes AS (
    SELECT jsonb_build_object(
      'id', 'private:' || md5(endpoint.person_id::text || ':' || auth.uid()::text),
      'full_name', 'Thành viên riêng tư',
      'gender', 'other',
      'birth_year', null,
      'death_year', null,
      'death_lunar_year', null,
      'avatar_url', null,
      'updated_at', null,
      'is_deceased', false,
      'is_in_law', false,
      'birth_order', null,
      'generation', null,
      'is_private_placeholder', true
    ) AS node
    FROM hidden_endpoints endpoint
  ),
  topology_edges AS (
    SELECT jsonb_build_object(
      'id', 'relationship:' || md5(access.id::text || ':' || auth.uid()::text),
      'type', access.type,
      'person_a', CASE
        WHEN access.can_view_a THEN access.person_a::text
        ELSE 'private:' || md5(access.person_a::text || ':' || auth.uid()::text)
      END,
      'person_b', CASE
        WHEN access.can_view_b THEN access.person_b::text
        ELSE 'private:' || md5(access.person_b::text || ':' || auth.uid()::text)
      END,
      'note', CASE WHEN access.can_view_a AND access.can_view_b THEN access.note ELSE null END,
      'created_at', null,
      'updated_at', null
    ) AS edge
    FROM relationship_access access
  )
  SELECT jsonb_build_object(
    'persons', COALESCE(
      (SELECT jsonb_agg(nodes.node ORDER BY nodes.node ->> 'id') FROM (
        SELECT node FROM visible_nodes
        UNION ALL
        SELECT node FROM hidden_nodes
      ) nodes),
      '[]'::jsonb
    ),
    'relationships', COALESCE(
      (SELECT jsonb_agg(topology_edges.edge ORDER BY topology_edges.edge ->> 'id') FROM topology_edges),
      '[]'::jsonb
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_family_tree_topology() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_family_tree_topology() TO authenticated;


-- 20260904090000_family_graph_queries.sql
create or replace function public.get_family_subtree(root_id uuid, max_depth integer, include_spouses boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  person_limit constant integer := 2000;
  relationship_limit constant integer := 6000;
begin
  if max_depth not between 1 and 10 then
    raise exception 'max_depth must be between 1 and 10';
  end if;

  if root_id is null or not public.can_view_person(root_id) then
    return jsonb_build_object('persons', '[]'::jsonb, 'relationships', '[]'::jsonb, 'truncated', false, 'maxDepth', max_depth);
  end if;

  return (
    with recursive descendants(person_id, depth, path) as (
      select root_id, 0, array[root_id]
      union all
      select relationship.person_b, descendants.depth + 1, descendants.path || relationship.person_b
      from descendants
      join public.relationships relationship
        on relationship.person_a = descendants.person_id
        and relationship.type in ('biological_child'::public.relationship_type_enum, 'adopted_child'::public.relationship_type_enum)
      where descendants.depth < max_depth
        and not relationship.person_b = any(descendants.path)
    ),
    traversal_people as (
      select person_id, min(depth) as depth
      from descendants
      group by person_id
    ),
    spouse_people as (
      select case when relationship.person_a = traversal.person_id then relationship.person_b else relationship.person_a end as person_id,
        traversal.depth
      from traversal_people traversal
      join public.relationships relationship
        on include_spouses
        and relationship.type = 'marriage'::public.relationship_type_enum
        and traversal.person_id in (relationship.person_a, relationship.person_b)
    ),
    candidate_people as (
      select person_id, depth from traversal_people
      union
      select person_id, depth from spouse_people
    ),
    bounded_people as (
      select person_id
      from candidate_people
      group by person_id
      order by min(depth), person_id
      limit person_limit
    ),
    relationship_access as (
      select relationship.*, public.can_view_person(relationship.person_a) as can_view_a, public.can_view_person(relationship.person_b) as can_view_b
      from public.relationships relationship
      where relationship.person_a in (select person_id from bounded_people)
        and relationship.person_b in (select person_id from bounded_people)
        and (public.can_view_person(relationship.person_a) or public.can_view_person(relationship.person_b))
        and (
          relationship.type in ('biological_child'::public.relationship_type_enum, 'adopted_child'::public.relationship_type_enum)
          or include_spouses
        )
    ),
    bounded_relationships as (
      select * from relationship_access order by id limit relationship_limit
    ),
    visible_nodes as (
      select jsonb_build_object(
        'id', person.id::text, 'full_name', person.full_name, 'gender', person.gender,
        'birth_year', person.birth_year, 'death_year', person.death_year, 'death_lunar_year', person.death_lunar_year,
        'avatar_url', person.avatar_url, 'updated_at', person.updated_at, 'is_deceased', person.is_deceased,
        'is_in_law', person.is_in_law, 'birth_order', person.birth_order, 'generation', person.generation,
        'is_private_placeholder', false
      ) as node
      from public.persons person
      where person.id in (select person_id from bounded_people)
        and public.can_view_person(person.id)
    ),
    hidden_nodes as (
      select jsonb_build_object(
        'id', 'private:' || md5(person_id::text || ':' || auth.uid()::text), 'full_name', 'Thành viên riêng tư',
        'gender', 'other', 'birth_year', null, 'death_year', null, 'death_lunar_year', null, 'avatar_url', null,
        'updated_at', null, 'is_deceased', false, 'is_in_law', false, 'birth_order', null, 'generation', null,
        'is_private_placeholder', true
      ) as node
      from bounded_people
      where not public.can_view_person(person_id)
    ),
    graph_edges as (
      select jsonb_build_object(
        'id', 'relationship:' || md5(relationship.id::text || ':' || auth.uid()::text), 'type', relationship.type,
        'person_a', case when relationship.can_view_a then relationship.person_a::text else 'private:' || md5(relationship.person_a::text || ':' || auth.uid()::text) end,
        'person_b', case when relationship.can_view_b then relationship.person_b::text else 'private:' || md5(relationship.person_b::text || ':' || auth.uid()::text) end,
        'note', case when relationship.can_view_a and relationship.can_view_b then relationship.note else null end,
        'created_at', null, 'updated_at', null
      ) as edge
      from bounded_relationships relationship
    )
    select jsonb_build_object(
      'persons', coalesce((select jsonb_agg(node order by node ->> 'id') from (select node from visible_nodes union all select node from hidden_nodes) nodes), '[]'::jsonb),
      'relationships', coalesce((select jsonb_agg(edge order by edge ->> 'id') from graph_edges), '[]'::jsonb),
      'truncated',
        exists (select 1 from candidate_people offset person_limit)
        or exists (select 1 from relationship_access offset relationship_limit)
        or exists (
          select 1
          from traversal_people traversal
          join public.relationships relationship
            on relationship.person_a = traversal.person_id
            and relationship.type in ('biological_child'::public.relationship_type_enum, 'adopted_child'::public.relationship_type_enum)
          where traversal.depth = max_depth
        ),
      'maxDepth', max_depth
    )
  );
end;
$$;

create or replace function public.get_person_neighborhood(person_id uuid, ancestor_depth integer, descendant_depth integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  person_limit constant integer := 2000;
  relationship_limit constant integer := 6000;
begin
  if ancestor_depth not between 1 and 10 or descendant_depth not between 1 and 10 then
    raise exception 'depth must be between 1 and 10';
  end if;

  if $1 is null or not public.can_view_person($1) then
    return jsonb_build_object('persons', '[]'::jsonb, 'relationships', '[]'::jsonb, 'truncated', false, 'maxDepth', greatest(ancestor_depth, descendant_depth));
  end if;

  return (
    with recursive ancestors(person_id, depth, path) as (
      select $1, 0, array[$1]
      union all
      select relationship.person_a, ancestors.depth + 1, ancestors.path || relationship.person_a
      from ancestors
      join public.relationships relationship
        on relationship.person_b = ancestors.person_id
        and relationship.type in ('biological_child'::public.relationship_type_enum, 'adopted_child'::public.relationship_type_enum)
      where ancestors.depth < ancestor_depth and not relationship.person_a = any(ancestors.path)
    ),
    descendants(person_id, depth, path) as (
      select $1, 0, array[$1]
      union all
      select relationship.person_b, descendants.depth + 1, descendants.path || relationship.person_b
      from descendants
      join public.relationships relationship
        on relationship.person_a = descendants.person_id
        and relationship.type in ('biological_child'::public.relationship_type_enum, 'adopted_child'::public.relationship_type_enum)
      where descendants.depth < descendant_depth and not relationship.person_b = any(descendants.path)
    ),
    candidate_people as (
      select person_id, min(depth) as distance
      from (select person_id, depth from ancestors union all select person_id, depth from descendants) graph_people
      group by person_id
    ),
    bounded_people as (
      select person_id from candidate_people order by distance, person_id limit person_limit
    ),
    relationship_access as (
      select relationship.*, public.can_view_person(relationship.person_a) as can_view_a, public.can_view_person(relationship.person_b) as can_view_b
      from public.relationships relationship
      where relationship.person_a in (select person_id from bounded_people)
        and relationship.person_b in (select person_id from bounded_people)
        and (public.can_view_person(relationship.person_a) or public.can_view_person(relationship.person_b))
    ),
    bounded_relationships as (
      select * from relationship_access order by id limit relationship_limit
    ),
    visible_nodes as (
      select jsonb_build_object(
        'id', person.id::text, 'full_name', person.full_name, 'gender', person.gender,
        'birth_year', person.birth_year, 'death_year', person.death_year, 'death_lunar_year', person.death_lunar_year,
        'avatar_url', person.avatar_url, 'updated_at', person.updated_at, 'is_deceased', person.is_deceased,
        'is_in_law', person.is_in_law, 'birth_order', person.birth_order, 'generation', person.generation,
        'is_private_placeholder', false
      ) as node
      from public.persons person
      where person.id in (select person_id from bounded_people) and public.can_view_person(person.id)
    ),
    hidden_nodes as (
      select jsonb_build_object(
        'id', 'private:' || md5(person_id::text || ':' || auth.uid()::text), 'full_name', 'Thành viên riêng tư',
        'gender', 'other', 'birth_year', null, 'death_year', null, 'death_lunar_year', null, 'avatar_url', null,
        'updated_at', null, 'is_deceased', false, 'is_in_law', false, 'birth_order', null, 'generation', null,
        'is_private_placeholder', true
      ) as node
      from bounded_people where not public.can_view_person(person_id)
    ),
    graph_edges as (
      select jsonb_build_object(
        'id', 'relationship:' || md5(relationship.id::text || ':' || auth.uid()::text), 'type', relationship.type,
        'person_a', case when relationship.can_view_a then relationship.person_a::text else 'private:' || md5(relationship.person_a::text || ':' || auth.uid()::text) end,
        'person_b', case when relationship.can_view_b then relationship.person_b::text else 'private:' || md5(relationship.person_b::text || ':' || auth.uid()::text) end,
        'note', case when relationship.can_view_a and relationship.can_view_b then relationship.note else null end,
        'created_at', null, 'updated_at', null
      ) as edge
      from bounded_relationships relationship
    )
    select jsonb_build_object(
      'persons', coalesce((select jsonb_agg(node order by node ->> 'id') from (select node from visible_nodes union all select node from hidden_nodes) nodes), '[]'::jsonb),
      'relationships', coalesce((select jsonb_agg(edge order by edge ->> 'id') from graph_edges), '[]'::jsonb),
      'truncated', exists (select 1 from candidate_people offset person_limit) or exists (select 1 from relationship_access offset relationship_limit),
      'maxDepth', greatest(ancestor_depth, descendant_depth)
    )
  );
end;
$$;

revoke all on function public.get_family_subtree(uuid, integer, boolean) from public, anon;
revoke all on function public.get_person_neighborhood(uuid, integer, integer) from public, anon;
grant execute on function public.get_family_subtree(uuid, integer, boolean) to authenticated;
grant execute on function public.get_person_neighborhood(uuid, integer, integer) to authenticated;



CREATE INDEX IF NOT EXISTS idx_persons_search_trgm ON public.persons USING gin (search_normalized extensions.gin_trgm_ops);
