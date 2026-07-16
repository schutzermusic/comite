-- ============================================================
-- MOBILE — Devices, geofences and evidence (Fase 4a)
-- Migration: 050_mobile_foundation
-- Date:      2026-07-15
-- Purpose:   Backend contract for the field mobile app (spec §6.6–6.8,
--            §13, §14, §20.2–20.6, diferencial D5):
--            1) registered_devices — device binding/trust.
--            2) project_geofences — cerca por canteiro (centro+raio;
--               distância por haversine, sem dependência de PostGIS).
--            3) location_evidence / authentication_evidence — evidências
--               capturadas nos eventos (não rastreamento contínuo).
--            4) liga attendance_punches e project_work_sessions às
--               evidências/dispositivo.
--            Idempotência de sync já garantida por
--            attendance_punches.client_event_id (migration 045).
-- Dependencies:
--   005 (helpers, set_updated_at()), 004 (projects.id TEXT)
--   038 (people, current_user_person_id()), 041 (project_work_sessions)
--   045 (attendance_punches)
--   051_mobile_perm_seeds (RBAC — data only)
-- NOTE: Idempotent, single transaction, RLS 030-safe.
-- ============================================================

BEGIN;

-- ============================================================
-- 1) registered_devices — device binding / trust
-- ============================================================
CREATE TABLE IF NOT EXISTS public.registered_devices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  person_id          uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  platform           text NOT NULL CHECK (platform IN ('ios','android','web')),
  device_public_id   text NOT NULL,
  device_name        text,
  enrolled_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz,
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','trusted','blocked','revoked')),
  integrity_level    text NOT NULL DEFAULT 'unknown'
                       CHECK (integrity_level IN ('unknown','basic','trusted','compromised')),
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS registered_devices_public_id_idx
  ON public.registered_devices (organization_id, device_public_id);
CREATE INDEX IF NOT EXISTS registered_devices_person_idx
  ON public.registered_devices (organization_id, person_id, status);

DROP TRIGGER IF EXISTS trg_registered_devices_updated_at ON public.registered_devices;
CREATE TRIGGER trg_registered_devices_updated_at
BEFORE UPDATE ON public.registered_devices
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 2) project_geofences — circular fence per project/site
-- ============================================================
CREATE TABLE IF NOT EXISTS public.project_geofences (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id         text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name               text NOT NULL,
  center_lat         double precision NOT NULL CHECK (center_lat BETWEEN -90 AND 90),
  center_lng         double precision NOT NULL CHECK (center_lng BETWEEN -180 AND 180),
  radius_meters      integer NOT NULL DEFAULT 200 CHECK (radius_meters > 0 AND radius_meters <= 50000),
  -- tolerância adicional por baixa precisão de GPS
  accuracy_tolerance_meters integer NOT NULL DEFAULT 50 CHECK (accuracy_tolerance_meters >= 0),
  active             boolean NOT NULL DEFAULT true,
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_geofences_project_idx
  ON public.project_geofences (organization_id, project_id, active);

DROP TRIGGER IF EXISTS trg_project_geofences_updated_at ON public.project_geofences;
CREATE TRIGGER trg_project_geofences_updated_at
BEFORE UPDATE ON public.project_geofences
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Haversine distance in meters — no PostGIS dependency.
CREATE OR REPLACE FUNCTION public.haversine_meters(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 6371000 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) *
    power(sin(radians(lng2 - lng1) / 2), 2)
  ))
$$;

-- ============================================================
-- 3) location_evidence — geographic evidence at an event
-- ============================================================
CREATE TABLE IF NOT EXISTS public.location_evidence (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id               uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  person_id                     uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  latitude                      double precision NOT NULL,
  longitude                     double precision NOT NULL,
  accuracy_meters               double precision,
  captured_at_device            timestamptz NOT NULL,
  received_at_server            timestamptz NOT NULL DEFAULT now(),
  geofence_id                   uuid REFERENCES project_geofences(id) ON DELETE SET NULL,
  distance_from_geofence_meters double precision,
  source                        text NOT NULL DEFAULT 'gps'
                                  CHECK (source IN ('gps','network','unknown')),
  offline_capture               boolean NOT NULL DEFAULT false,
  device_id                     uuid REFERENCES registered_devices(id) ON DELETE SET NULL,
  integrity_status              text NOT NULL DEFAULT 'unverified'
                                  CHECK (integrity_status IN ('trusted','limited','suspicious','unverified')),
  metadata                      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS location_evidence_person_idx
  ON public.location_evidence (organization_id, person_id, captured_at_device DESC);

-- ============================================================
-- 4) authentication_evidence — auth outcome at an event
-- ============================================================
CREATE TABLE IF NOT EXISTS public.authentication_evidence (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  person_id          uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  device_id          uuid REFERENCES registered_devices(id) ON DELETE SET NULL,
  method             text NOT NULL
                       CHECK (method IN ('device_biometric','device_credential','facial_verification','manager_override')),
  result             text NOT NULL CHECK (result IN ('success','failure')),
  assurance_level    text NOT NULL DEFAULT 'basic'
                       CHECK (assurance_level IN ('basic','standard','enhanced')),
  verified_at        timestamptz NOT NULL DEFAULT now(),
  provider_reference text,
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS authentication_evidence_person_idx
  ON public.authentication_evidence (organization_id, person_id, verified_at DESC);

-- ============================================================
-- 5) link punches + sessions to device/evidence
-- ============================================================
ALTER TABLE public.attendance_punches
  ADD COLUMN IF NOT EXISTS device_id uuid REFERENCES registered_devices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS location_evidence_id uuid REFERENCES location_evidence(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS authentication_evidence_id uuid REFERENCES authentication_evidence(id) ON DELETE SET NULL;

ALTER TABLE public.project_work_sessions
  ADD COLUMN IF NOT EXISTS device_id uuid REFERENCES registered_devices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS location_evidence_start_id uuid REFERENCES location_evidence(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS location_evidence_end_id uuid REFERENCES location_evidence(id) ON DELETE SET NULL;

-- ============================================================
-- 6) Row Level Security (030-safe)
-- ============================================================
ALTER TABLE public.registered_devices       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_geofences        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_evidence        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authentication_evidence  ENABLE ROW LEVEL SECURITY;

-- ---------- registered_devices: owner manages own; manager sees all ----------
DROP POLICY IF EXISTS registered_devices_select ON public.registered_devices;
CREATE POLICY registered_devices_select ON public.registered_devices
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       person_id = current_user_person_id()
    OR current_user_has_permission('people.attendance_manage')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS registered_devices_insert ON public.registered_devices;
CREATE POLICY registered_devices_insert ON public.registered_devices
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
       (person_id = current_user_person_id() AND current_user_has_permission('people.attendance_use'))
    OR current_user_has_permission('people.attendance_manage')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS registered_devices_update ON public.registered_devices;
CREATE POLICY registered_devices_update ON public.registered_devices
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       person_id = current_user_person_id()
    OR current_user_has_permission('people.attendance_manage')
    OR current_user_is_admin()
  )
)
WITH CHECK (organization_id = current_user_organization_id());

-- ---------- project_geofences: view broad, manage gated ----------
DROP POLICY IF EXISTS project_geofences_select ON public.project_geofences;
CREATE POLICY project_geofences_select ON public.project_geofences
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('people.attendance_use')
    OR current_user_has_permission('people.attendance_view')
    OR current_user_has_permission('projects.view')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS project_geofences_write ON public.project_geofences;
CREATE POLICY project_geofences_write ON public.project_geofences
FOR ALL TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('people.geofence_manage') OR current_user_is_admin())
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('people.geofence_manage') OR current_user_is_admin())
);

-- ---------- evidence: owner inserts own; view by owner/manager ----------
DROP POLICY IF EXISTS location_evidence_select ON public.location_evidence;
CREATE POLICY location_evidence_select ON public.location_evidence
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       person_id = current_user_person_id()
    OR current_user_has_permission('people.attendance_view')
    OR current_user_has_permission('people.attendance_manage')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS location_evidence_insert ON public.location_evidence;
CREATE POLICY location_evidence_insert ON public.location_evidence
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
       (person_id = current_user_person_id() AND current_user_has_permission('people.attendance_use'))
    OR current_user_has_permission('people.attendance_manage')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS authentication_evidence_select ON public.authentication_evidence;
CREATE POLICY authentication_evidence_select ON public.authentication_evidence
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       person_id = current_user_person_id()
    OR current_user_has_permission('people.attendance_view')
    OR current_user_has_permission('people.attendance_manage')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS authentication_evidence_insert ON public.authentication_evidence;
CREATE POLICY authentication_evidence_insert ON public.authentication_evidence
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
       (person_id = current_user_person_id() AND current_user_has_permission('people.attendance_use'))
    OR current_user_has_permission('people.attendance_manage')
    OR current_user_is_admin()
  )
);

COMMIT;

-- ============================================================
-- Manual verification checklist (staging)
--   1. Re-run -> no-op.
--   2. haversine_meters(-19.9,-43.9,-19.9,-43.9) = 0; ~1km apart ≈ 1000.
--   3. Enroll same device_public_id twice -> unique (upsert-safe).
--   4. Owner reads own devices/evidence; without perms, others hidden.
--
-- ROLLBACK (manual):
--   ALTER TABLE project_work_sessions DROP COLUMN IF EXISTS device_id,
--     DROP COLUMN IF EXISTS location_evidence_start_id, DROP COLUMN IF EXISTS location_evidence_end_id;
--   ALTER TABLE attendance_punches DROP COLUMN IF EXISTS device_id,
--     DROP COLUMN IF EXISTS location_evidence_id, DROP COLUMN IF EXISTS authentication_evidence_id;
--   DROP TABLE IF EXISTS authentication_evidence, location_evidence, project_geofences, registered_devices;
--   DROP FUNCTION IF EXISTS haversine_meters(double precision,double precision,double precision,double precision);
-- ============================================================
