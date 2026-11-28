BEGIN;
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS private.execution_reservations (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth.users(id),
 provider text NOT NULL CHECK (provider IN ('metatrader','deriv')),
 account_id text NOT NULL,
 signal_key text NOT NULL,
 status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','submitting','unknown','confirmed','rejected')),
 broker_order_id text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,provider,account_id,signal_key),
 CHECK (status <> 'confirmed' OR broker_order_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS execution_one_unresolved_per_account ON private.execution_reservations(provider,account_id) WHERE status IN ('reserved','submitting','unknown');
ALTER TABLE private.execution_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.execution_reservations FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
