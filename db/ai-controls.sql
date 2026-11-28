BEGIN;
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS private.ai_controls (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 running boolean NOT NULL DEFAULT false,
 emergency_stop boolean NOT NULL DEFAULT true,
 enabled_agent_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
 revision bigint NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.ai_controls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.ai_controls FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
