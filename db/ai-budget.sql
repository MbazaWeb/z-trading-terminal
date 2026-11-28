BEGIN;
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS private.ai_budget_reservations (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  reserved_micro_usd bigint NOT NULL CHECK (reserved_micro_usd > 0),
  actual_micro_usd bigint CHECK (actual_micro_usd >= 0),
  response_id text
);
CREATE INDEX IF NOT EXISTS ai_budget_created_idx ON private.ai_budget_reservations(created_at);
ALTER TABLE private.ai_budget_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.ai_budget_reservations FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
