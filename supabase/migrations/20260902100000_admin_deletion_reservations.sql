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
