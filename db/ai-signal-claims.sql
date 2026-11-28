BEGIN;
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS private.ai_signal_claims (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 provider text NOT NULL,
 account_id text NOT NULL,
 symbol text NOT NULL,
 candle_time bigint NOT NULL CHECK (candle_time > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,provider,account_id,symbol,candle_time)
);
ALTER TABLE private.ai_signal_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.ai_signal_claims FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
