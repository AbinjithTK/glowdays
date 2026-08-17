-- Diary entry photos.
--
-- An optional snapshot stuck to a written entry, the way an instant photo gets
-- taped into a paper diary. Nullable, so every existing note stays valid and this
-- migration cannot fail on data.
--
-- Deliberately a separate column from scan.image_key rather than a reuse of it.
-- A check-in photo is a measuring instrument: graded on framing and light, used to
-- pick an analysis tier, and sent to the provider under explicit consent. An entry
-- photo is a memento and is never analysed and never sent anywhere. Conflating them
-- in one column would make it impossible to tell, later, which photographs a person
-- had consented to have analysed.
--
-- The key lives under the same per-profile storage prefix as everything else, so
-- account deletion already removes it and needs no additional sweep.

ALTER TABLE "note" ADD COLUMN IF NOT EXISTS "image_key" text;
