CREATE OR REPLACE FUNCTION public.record_murmur_visit(p_visitor_id uuid, p_page_path text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_path text;
  v_headers jsonb := coalesce(nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  v_ip_text text := nullif(pg_catalog.split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1), '');
  v_ip inet;
  v_window timestamptz := pg_catalog.date_bin(interval '5 minutes', pg_catalog.clock_timestamp(), timestamptz '2000-01-01 00:00:00+00');
  v_count integer;
BEGIN
  IF p_visitor_id IS NULL THEN
    RETURN false;
  END IF;

  v_path := pg_catalog.left(coalesce(p_page_path, '/'), 120);
  IF v_path !~ '^(/[a-zA-Z0-9/_-]*)?$' THEN
    v_path := '/';
  END IF;

  -- Per-visitor throttle: at most 40 accepted events in each five-minute window.
  INSERT INTO private.api_rate_limits(bucket_key, window_start, request_count)
  VALUES ('visitor:' || p_visitor_id::text, v_window, 1)
  ON CONFLICT (bucket_key, window_start)
  DO UPDATE SET request_count = private.api_rate_limits.request_count + 1
  RETURNING request_count INTO v_count;

  IF v_count > 40 THEN
    RETURN false;
  END IF;

  -- Use the first proxy-forwarded address when available. Invalid header values
  -- are ignored; the per-visitor limit still applies.
  BEGIN
    IF v_ip_text IS NOT NULL THEN
      v_ip := pg_catalog.btrim(v_ip_text)::inet;
    END IF;
  EXCEPTION WHEN others THEN
    v_ip := NULL;
  END;

  IF v_ip IS NOT NULL THEN
    INSERT INTO private.api_rate_limits(bucket_key, window_start, request_count)
    VALUES ('visitor-ip:' || pg_catalog.md5(pg_catalog.host(v_ip)), v_window, 1)
    ON CONFLICT (bucket_key, window_start)
    DO UPDATE SET request_count = private.api_rate_limits.request_count + 1
    RETURNING request_count INTO v_count;

    IF v_count > 200 THEN
      RETURN false;
    END IF;
  END IF;

  INSERT INTO private.murmur_visitor_devices (visitor_id)
  VALUES (p_visitor_id)
  ON CONFLICT (visitor_id)
  DO UPDATE SET last_seen_at = pg_catalog.now();

  INSERT INTO private.murmur_visitor_events (visitor_id, page_path)
  VALUES (p_visitor_id, v_path);

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_murmur_visit(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_murmur_visit(uuid, text) TO anon, authenticated, service_role;
