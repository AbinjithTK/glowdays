/**
 * Database schema.
 *
 * The single most important structural fact, from APP_ARCHITECTURE §1.7:
 *
 *   A scan belongs to the PROFILE, never to a trial.
 *
 * The diary is the spine. A trial is a window over it that claims scans by
 * date range. Getting this backwards turns the product into a product tracker
 * with a diary bolted on, and makes every comparison read as a causal claim
 * about a product - which is exactly the claim this app exists not to make.
 *
 * Raw scores are stored as double precision because the provider returns many
 * decimal places (72.011962890625). `ui_score` is stored but never compared:
 * the provider's own documentation says it is adjusted upward for user comfort.
 */

import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------- enums

/** Two analysis tiers. They must never be compared with each other. */
export const tierEnum = pgEnum('tier', ['hd', 'sd']);

/**
 * A scan is a durable local record moving through states, not a request.
 * `expired` must never be presented as data loss - our copy of the photo is
 * still ours; it is the provider's task that lapsed.
 */
export const scanStatusEnum = pgEnum('scan_status', [
  'draft',
  'uploading',
  'queued',
  'running',
  'succeeded',
  'failed',
  'expired',
]);

/**
 * Whether the trial's metric was named before the first scan existed.
 * Only `pre_registered` trials may feed pooled evidence, because choosing a
 * metric after seeing scores measures regression to the mean.
 */
export const trialKindEnum = pgEnum('trial_kind', ['pre_registered', 'exploratory']);

export const trialStatusEnum = pgEnum('trial_status', [
  'active',
  'completed',
  'stopped',
  'archived',
]);

export const productKindEnum = pgEnum('product_kind', [
  'cleanser',
  'serum',
  'moisturiser',
  'sunscreen',
  'treatment',
  'other',
]);

/** Where capture conditions came from. Measured beats declared. */
export const qualitySourceEnum = pgEnum('quality_source', ['camerakit', 'declared']);

// ---------------------------------------------------------------- profile

export const profile = pgTable(
  'profile',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Opaque subject from the identity provider. Cognito `sub` today. */
    authUid: text('auth_uid').notNull(),
    email: text('email').notNull(),
    displayName: text('display_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('profile_auth_uid_key').on(t.authUid)],
);

// ---------------------------------------------------------------- product

export const product = pgTable(
  'product',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profile.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    brand: text('brand'),
    kind: productKindEnum('kind').notNull().default('other'),
    /** When the user started using it. May predate the diary. */
    startedOn: date('started_on'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('product_profile_idx').on(t.profileId)],
);

// ---------------------------------------------------------------- trial

export const trial = pgTable(
  'trial',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profile.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'restrict' }),
    /** The metric the user predicted would move. A `MetricId` from core. */
    predictedMetric: text('predicted_metric').notNull(),
    kind: trialKindEnum('kind').notNull(),
    status: trialStatusEnum('status').notNull().default('active'),
    /** The window. Scans are claimed by falling inside it. */
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    cadenceDays: integer('cadence_days').notNull().default(14),
    /** Set when the user committed. Null means still being set up. */
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    /**
     * False once a second product is introduced mid-trial. The trial keeps
     * running and keeps its check-ins; only attribution is no longer clean.
     */
    singleVariable: boolean('single_variable').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('trial_profile_idx').on(t.profileId),
    index('trial_window_idx').on(t.profileId, t.startsAt, t.endsAt),
    /**
     * At most one active trial per profile. Overlapping trials are confounded
     * by definition, so this is enforced in the database rather than in code.
     */
    uniqueIndex('trial_one_active_per_profile')
      .on(t.profileId)
      .where(sql`status = 'active'`),
  ],
);

// ---------------------------------------------------------------- scan

export const scan = pgTable(
  'scan',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Owned by the profile. Never by a trial. See the note at the top. */
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profile.id, { onDelete: 'cascade' }),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    tier: tierEnum('tier').notNull(),
    status: scanStatusEnum('status').notNull().default('draft'),

    /** Our private object key. Never public, never guessable. */
    imageKey: text('image_key'),

    /** Provider handles. Both expire after 30 days. */
    youcamFileId: text('youcam_file_id'),
    youcamTaskId: text('youcam_task_id'),

    /**
     * Explicit consent, recorded before the image leaves our storage.
     * No consent row means no analysis call is permitted.
     */
    consentAt: timestamp('consent_at', { withTimezone: true }),
    consentPolicyVersion: text('consent_policy_version'),

    /** Provider error code on failure, e.g. error_src_face_too_small. */
    errorCode: text('error_code'),

    /**
     * `all.score` as returned. The provider computes this independently rather
     * than averaging the metrics, so it must be displayed as given and never
     * recomputed from the visible rows - the two will not agree, and the
     * prototype shipped a headline delta that did not match its own metrics
     * for exactly this reason.
     */
    overallScore: doublePrecision('overall_score'),
    /** `skin_age`. Informational only; it is not a metric and never compared. */
    skinAge: integer('skin_age'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('scan_profile_captured_idx').on(t.profileId, t.capturedAt),
    index('scan_status_idx').on(t.status),
    uniqueIndex('scan_task_key').on(t.youcamTaskId),
  ],
);

// ------------------------------------------------------- capture quality

/**
 * Measured capture conditions, one row per scan.
 *
 * This is what turns confidence from an assertion into a computation. The
 * numbers come from CameraKit before the shutter fires. `declaredLight` is the
 * user's optional colour commentary and is never an input to confidence.
 */
export const captureQuality = pgTable('capture_quality', {
  scanId: uuid('scan_id')
    .primaryKey()
    .references(() => scan.id, { onDelete: 'cascade' }),
  source: qualitySourceEnum('source').notNull().default('camerakit'),
  /** 0..1 */
  lightingLevel: doublePrecision('lighting_level').notNull(),
  /** 0..1 luma difference between the eyes. */
  lightingUneven: doublePrecision('lighting_uneven').notNull(),
  /** 0.55..1 face width as a proportion of frame width. */
  faceRatio: doublePrecision('face_ratio').notNull(),
  yaw: doublePrecision('yaw').notNull(),
  pitch: doublePrecision('pitch').notNull(),
  roll: doublePrecision('roll').notNull(),
  /** Which CameraKit preset was active. Makes the choice auditable. */
  preset: text('preset').notNull().default('MODERATE'),
  /** Short side in pixels. Decides the tier; below 1080 cannot be HD. */
  shortSidePx: integer('short_side_px').notNull(),
  /** Optional user-declared bucket. Colour only. */
  declaredLight: text('declared_light'),
});

// ---------------------------------------------------------------- scores

export const scanMetric = pgTable(
  'scan_metric',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scanId: uuid('scan_id')
      .notNull()
      .references(() => scan.id, { onDelete: 'cascade' }),
    /** A `MetricId` from @glowdays/core. */
    metric: text('metric').notNull(),
    /** 'whole' for single-value metrics, or a provider subcategory. */
    region: text('region').notNull().default('whole'),
    /** The number we compare. Always raw. */
    rawScore: doublePrecision('raw_score'),
    /** Stored for audit only. The provider adjusts it upward for comfort. */
    uiScore: integer('ui_score'),
    /** Categorical metrics such as skin type have a value, not a score. */
    categoryValue: text('category_value'),
  },
  (t) => [uniqueIndex('scan_metric_key').on(t.scanId, t.metric, t.region)],
);

export const scanMask = pgTable(
  'scan_mask',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scanId: uuid('scan_id')
      .notNull()
      .references(() => scan.id, { onDelete: 'cascade' }),
    metric: text('metric').notNull(),
    region: text('region').notNull().default('whole'),
    /**
     * Our own copy. The provider's mask URL dies after two hours, so masks are
     * copied server-side on success rather than fetched lazily on first view.
     */
    storageKey: text('storage_key').notNull(),
    copiedAt: timestamp('copied_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('scan_mask_key').on(t.scanId, t.metric, t.region)],
);

// ---------------------------------------------------------------- notes

export const note = pgTable(
  'note',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profile.id, { onDelete: 'cascade' }),
    /** Optional link to a check-in. Notes may exist on their own. */
    scanId: uuid('scan_id').references(() => scan.id, { onDelete: 'set null' }),
    /**
     * The day the note is about. May be backdated - a user can record that
     * their skin stung last Tuesday. A photo may never be backdated.
     */
    noteOn: date('note_on').notNull(),
    body: text('body').notNull(),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    /**
     * An optional snapshot stuck to the entry, like an instant photo taped into a
     * paper diary.
     *
     * Deliberately separate from a check-in's `imageKey`, and never analysed. A
     * check-in photo is a measurement instrument: it is graded on framing and
     * light, it decides a tier, and it is sent to the provider. This is a memento -
     * a rash on your wrist, the label of something you started, the light in the
     * room that day. Sending it for analysis would produce a reading nobody asked
     * for and spend units doing it, and grading it on framing would be absurd.
     *
     * Stored in the same per-profile prefix, so account deletion removes it with
     * everything else and no extra sweep is needed.
     */
    imageKey: text('image_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('note_profile_date_idx').on(t.profileId, t.noteOn)],
);

// ------------------------------------------------------------ entitlement

/**
 * Subscription state, written by the RevenueCat webhook.
 *
 * RevenueCat is the source of truth and this table is its projection. It is
 * deliberately NOT in the identity provider's custom claims: two systems both
 * believing they are authoritative is how entitlement bugs happen.
 */
export const entitlement = pgTable(
  'entitlement',
  {
    profileId: uuid('profile_id')
      .primaryKey()
      .references(() => profile.id, { onDelete: 'cascade' }),
    /** RevenueCat entitlement identifier. */
    entitlementId: text('entitlement_id').notNull(),
    isActive: boolean('is_active').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('entitlement_active_idx').on(t.isActive)],
);

// ---------------------------------------------------------------- relations

export const profileRelations = relations(profile, ({ many, one }) => ({
  scans: many(scan),
  trials: many(trial),
  products: many(product),
  notes: many(note),
  entitlement: one(entitlement),
}));

export const scanRelations = relations(scan, ({ one, many }) => ({
  profile: one(profile, { fields: [scan.profileId], references: [profile.id] }),
  quality: one(captureQuality),
  metrics: many(scanMetric),
  masks: many(scanMask),
}));

export const trialRelations = relations(trial, ({ one }) => ({
  profile: one(profile, { fields: [trial.profileId], references: [profile.id] }),
  product: one(product, { fields: [trial.productId], references: [product.id] }),
}));

export const scanMetricRelations = relations(scanMetric, ({ one }) => ({
  scan: one(scan, { fields: [scanMetric.scanId], references: [scan.id] }),
}));
