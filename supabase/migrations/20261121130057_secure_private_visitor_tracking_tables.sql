-- Protect anonymous visitor analytics from direct table access.
-- The SECURITY DEFINER RPC remains the sole browser-facing write path.
ALTER TABLE private.murmur_visitor_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.murmur_visitor_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  private.murmur_visitor_devices,
  private.murmur_visitor_events
FROM PUBLIC, anon, authenticated;

-- Keep the RPC callable for anonymous visitor tracking; its owner is postgres,
-- its search_path is empty, and it uses schema-qualified table references.
GRANT EXECUTE ON FUNCTION public.record_murmur_visit(uuid, text) TO anon, authenticated;

COMMENT ON TABLE private.murmur_visitor_devices IS
  'Private visitor device registry. Browser roles have no direct table access; writes go through public.record_murmur_visit.';
COMMENT ON TABLE private.murmur_visitor_events IS
  'Private visitor page-event log. Browser roles have no direct table access; writes go through public.record_murmur_visit.';
