import time
from datetime import datetime, timezone

def schema(db):
    db.execute("CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, status TEXT NOT NULL)")
    db.execute("CREATE TABLE IF NOT EXISTS intent (id TEXT PRIMARY KEY, login TEXT, server TEXT, kind TEXT, ticket TEXT, symbol TEXT, comment TEXT, volume REAL, side INTEGER, sl REAL, tp REAL, created REAL)")
    db.execute("CREATE TABLE IF NOT EXISTS reconciliation (id TEXT PRIMARY KEY, evidence TEXT, checked REAL)")
    db.execute("CREATE TABLE IF NOT EXISTS modify_requests (ticket TEXT PRIMARY KEY, id TEXT NOT NULL)")

def record(db, body, req, kind):
    schema(db)
    db.execute("INSERT INTO intent VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",(str(body.request_id),str(body.login),body.server,kind,str(req["position"]) if "position" in req else None,req["symbol"],req.get("comment"),req.get("volume"),req.get("type"),req.get("sl"),req.get("tp"),time.time()))

def reconcile(mt5, db, account):
    schema(db)
    rows=db.execute("SELECT i.* FROM intent i JOIN requests r ON i.id=r.id WHERE r.status IN ('pending','uncertain') AND i.login=? AND i.server=?",(str(account.login),account.server)).fetchall()
    for rid,login,server,kind,ticket,symbol,comment,volume,side,sl,tp,created in rows:
        evidence=None
        if kind=="modify":
            positions=mt5.positions_get(ticket=int(ticket))
            if positions is not None and len(positions)==1:
                p=positions[0]
                if p.symbol==symbol and p.sl==sl and p.tp==tp:
                    evidence="Requested protective levels observed"
        else:
            deals=mt5.history_deals_get(datetime.fromtimestamp(created-120,timezone.utc),datetime.now(timezone.utc))
            if deals is None:
                continue
            entry=mt5.DEAL_ENTRY_IN if kind=="open" else mt5.DEAL_ENTRY_OUT
            matches=[d for d in deals if d.comment==comment and d.symbol==symbol and d.magic==260427 and d.type==side and d.entry==entry and abs(d.volume-volume)<1e-9]
            if len(matches)==1:
                if kind=="open":
                    evidence="Entry deal "+str(matches[0].ticket)
                else:
                    positions=mt5.positions_get(ticket=int(ticket))
                    if positions is not None and len(positions)==0:
                        evidence="Exit deal "+str(matches[0].ticket)+"; position absent"
        if evidence:
            db.execute("UPDATE requests SET status='reconciled' WHERE id=?",(rid,))
            db.execute("INSERT OR REPLACE INTO reconciliation VALUES (?,?,?)",(rid,evidence,time.time()))
            if kind=="modify":
                db.execute("DELETE FROM modify_requests WHERE id=?",(rid,))
    db.commit()
