-- 0001_init
--
-- Written by hand rather than generated. drizzle-kit was the only dependency
-- pulling esbuild, whose blocked install script made every pnpm script in the
-- workspace exit non-zero. Owning the SQL removes that toolchain entirely and
-- makes the constraints below reviewable, which matters because two of them
-- carry product rules that code must not be trusted to enforce.

-- No CREATE EXTENSION here. `gen_random_uuid()` has been in core Postgres since
-- 13, so pgcrypto is not needed, and requiring it breaks the embedded
-- WebAssembly build used for local development, which ships without contrib
-- extensions. Requiring an extension we do not use would also mean asking for
-- privileges the application role should not have on a managed database.

-- ---------------------------------------------------------------- enums

DO $$ BEGIN
  CREATE TYPE tier AS ENUM ('hd', 'sd');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE scan_status AS ENUM
    ('draft', 'uploading', 'queued', 'running', 'succeeded', 'failed', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE trial_kind AS ENUM ('pre_registered', 'exploratory');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE trial_status AS ENUM ('active', 'completed', 'stopped', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE product_kind AS ENUM
    ('cleanser', 'serum', 'moisturiser', 'sunscreen', 'treatment', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE quality_source AS ENUM ('camerakit', 'declared');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -------------------------------------------------------------- profile

CREATE TABLE IF NOT EXISTS profile (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_uid     text NOT NULL,
  email        text NOT NULL,
  display_name text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

-- Keyed on the identity provider's subject, never on email. Emails change, and
-- the same address arriving twice through different sign-in methods must not
-- merge two people's diaries.
CREATE UNIQUE INDEX IF NOT EXISTS profile_auth_uid_key ON profile (auth_uid);

-- -------------------------------------------------------------- product

CREATE TABLE IF NOT EXISTS product (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profile (id) ON DELETE CASCADE,
  name       text NOT NULL,
  brand      text,
  kind       product_kind NOT NULL DEFAULT 'other',
  started_on date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_profile_idx ON product (profile_id);

-- ---------------------------------------------------------------- trial

CREATE TABLE IF NOT EXISTS trial (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id       uuid NOT NULL REFERENCES profile (id) ON DELETE CASCADE,
  -- RESTRICT, not CASCADE. Deleting a product out from under a trial would
  -- leave a comparison with no subject.
  product_id       uuid NOT NULL REFERENCES product (id) ON DELETE RESTRICT,
  predicted_metric text NOT NULL,
  kind             trial_kind NOT NULL,
  status           trial_status NOT NULL DEFAULT 'active',
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  cadence_days     integer NOT NULL DEFAULT 14,
  locked_at        timestamptz,
  single_variable  boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trial_profile_idx ON trial (profile_id);
CREATE INDEX IF NOT EXISTS trial_window_idx ON trial (profile_id, starts_at, ends_at);

-- At most one active trial per person. Two products running at once are
-- confounded by definition, so this is a database rule rather than a check in
-- application code that a second code path could forget.
CREATE UNIQUE INDEX IF NOT EXISTS trial_one_active_per_profile
  ON trial (profile_id)
  WHERE status = 'active';

-- ----------------------------------------------------------------- scan

-- A scan belongs to the profile, never to a trial. The diary is the spine and a
-- trial is a window over it that claims scans by date range. Reversed, every
-- comparison would read as a causal claim about a product.
CREATE TABLE IF NOT EXISTS scan (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id             uuid NOT NULL REFERENCES profile (id) ON DELETE CASCADE,
  captured_at            timestamptz NOT NULL,
  tier                   tier NOT NULL,
  status                 scan_status NOT NULL DEFAULT 'draft',
  image_key              text,
  youcam_file_id         text,
  youcam_task_id         text,
  consent_at             timestamptz,
  consent_policy_version text,
  error_code             text,
  overall_score          double precision,
  skin_age               integer,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scan_profile_captured_idx ON scan (profile_id, captured_at);
CREATE INDEX IF NOT EXISTS scan_status_idx ON scan (status);
CREATE UNIQUE INDEX IF NOT EXISTS scan_task_key ON scan (youcam_task_id);

-- ------------------------------------------------------- capture_quality

-- What makes confidence a computation rather than an assertion. These come from
-- CameraKit before the shutter fires; declared_light is the user's optional
-- colour commentary and is never an input.
CREATE TABLE IF NOT EXISTS capture_quality (
  scan_id         uuid PRIMARY KEY REFERENCES scan (id) ON DELETE CASCADE,
  source          quality_source NOT NULL DEFAULT 'camerakit',
  lighting_level  double precision NOT NULL,
  lighting_uneven double precision NOT NULL,
  face_ratio      double precision NOT NULL,
  yaw             double precision NOT NULL,
  pitch           double precision NOT NULL,
  roll            double precision NOT NULL,
  preset          text NOT NULL DEFAULT 'MODERATE',
  short_side_px   integer NOT NULL,
  declared_light  text
);

-- ---------------------------------------------------------- scan_metric

CREATE TABLE IF NOT EXISTS scan_metric (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id        uuid NOT NULL REFERENCES scan (id) ON DELETE CASCADE,
  metric         text NOT NULL,
  region         text NOT NULL DEFAULT 'whole',
  -- double precision because the provider returns many decimal places, and
  -- raw_score is the only figure ever compared. ui_score is adjusted upward by
  -- the provider for user comfort and is stored for audit only.
  raw_score      double precision,
  ui_score       integer,
  category_value text
);

CREATE UNIQUE INDEX IF NOT EXISTS scan_metric_key
  ON scan_metric (scan_id, metric, region);

-- ------------------------------------------------------------ scan_mask

CREATE TABLE IF NOT EXISTS scan_mask (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id     uuid NOT NULL REFERENCES scan (id) ON DELETE CASCADE,
  metric      text NOT NULL,
  region      text NOT NULL DEFAULT 'whole',
  -- Our own copy. The provider's mask URLs expire two hours after the task
  -- completes, so masks are copied on success rather than fetched on first view.
  storage_key text NOT NULL,
  copied_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS scan_mask_key
  ON scan_mask (scan_id, metric, region);

-- ----------------------------------------------------------------- note

CREATE TABLE IF NOT EXISTS note (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profile (id) ON DELETE CASCADE,
  -- SET NULL, not CASCADE. Deleting a photo must not silently delete what the
  -- person wrote about that day.
  scan_id    uuid REFERENCES scan (id) ON DELETE SET NULL,
  note_on    date NOT NULL,
  body       text NOT NULL,
  tags       jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS note_profile_date_idx ON note (profile_id, note_on);

-- ---------------------------------------------------------- entitlement

-- A projection of the billing webhook, not a second source of truth, and
-- deliberately not an identity-provider claim.
CREATE TABLE IF NOT EXISTS entitlement (
  profile_id     uuid PRIMARY KEY REFERENCES profile (id) ON DELETE CASCADE,
  entitlement_id text NOT NULL,
  is_active      boolean NOT NULL DEFAULT false,
  expires_at     timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS entitlement_active_idx ON entitlement (is_active);
