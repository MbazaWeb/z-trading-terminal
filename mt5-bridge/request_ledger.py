"""Local durable submission ledger. Unknown requests must be reconciled, never retried."""
import sqlite3
from contextlib import closing
from pathlib import Path
from uuid import UUID

def reserve_request(path: Path, request_id: str, account: str, fingerprint: str):
    request_id = str(UUID(request_id))
    if not account or not fingerprint:
        raise ValueError("Missing request identity")
    with closing(sqlite3.connect(path, timeout=10)) as db, db:
        db.execute("PRAGMA synchronous=FULL")
        db.execute("""CREATE TABLE IF NOT EXISTS submissions (
            id TEXT PRIMARY KEY, account TEXT NOT NULL, fingerprint TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('submitting','unknown','confirmed')),
            broker_id TEXT)""")
        db.execute("BEGIN IMMEDIATE")
        existing = db.execute("SELECT status FROM submissions WHERE id=?", (request_id,)).fetchone()
        if existing:
            raise RuntimeError("Request already recorded; reconcile before proceeding")
        if db.execute("SELECT 1 FROM submissions WHERE account=? AND status IN ('submitting','unknown')", (account,)).fetchone():
            raise RuntimeError("Unresolved broker submission")
        db.execute("INSERT INTO submissions VALUES (?,?,?,'submitting',NULL)", (request_id,account,fingerprint))

def record_outcome(path: Path, request_id: str, broker_id: str | None):
    with closing(sqlite3.connect(path, timeout=10)) as db, db:
        db.execute("PRAGMA synchronous=FULL")
        result = db.execute("UPDATE submissions SET status=?,broker_id=? WHERE id=? AND status='submitting'",
            ("confirmed" if broker_id else "unknown",broker_id,str(UUID(request_id))))
        if result.rowcount != 1:
            raise RuntimeError("Submission state unavailable")


def unresolved_requests(path: Path, account: str) -> list[dict]:
    """Read pending recovery records without clearing or retrying them."""
    if not account or not path.is_file():
        raise RuntimeError("Existing account ledger required")
    with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=10)) as db:
        db.row_factory = sqlite3.Row
        rows = db.execute(
            "SELECT id, account, fingerprint, status, broker_id FROM submissions "
            "WHERE account=? AND status IN ('submitting','unknown') ORDER BY id",
            (account,),
        ).fetchall()
        return [dict(row) for row in rows]
