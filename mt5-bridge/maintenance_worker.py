"""Independent read-only maintenance thread, durable account-scoped snapshots."""
import json
import sqlite3
import threading
import time
from contextlib import closing

class MaintenanceWorker:
    def __init__(self,path,account,collect):
        self.path,self.account,self.collect=path,account,collect
        self.stop=threading.Event()
        with closing(sqlite3.connect(path)) as db:
            db.execute("CREATE TABLE IF NOT EXISTS worker_snapshot (account TEXT PRIMARY KEY, payload TEXT)")
            db.execute("CREATE TABLE IF NOT EXISTS broker_deals (account TEXT, ticket TEXT, payload TEXT, PRIMARY KEY(account,ticket))")
            db.commit()
        self.thread=threading.Thread(target=self.run,daemon=True,name="mt5-maintenance")
        self.thread.start()

    def run(self):
        while not self.stop.is_set():
            started=time.time()
            try:
                snapshot,deals=self.collect()
                with closing(sqlite3.connect(self.path)) as db:
                    for deal in deals:
                        db.execute("INSERT OR IGNORE INTO broker_deals VALUES (?,?,?)",(self.account,deal["ticket"],json.dumps(deal,allow_nan=False)))
                    snapshot.update(state="healthy",checkedAt=time.time(),nextRun=time.time()+30)
                    db.execute("INSERT OR REPLACE INTO worker_snapshot VALUES (?,?)",(self.account,json.dumps(snapshot,allow_nan=False)))
                    db.commit()
            except Exception:
                try:
                    with closing(sqlite3.connect(self.path)) as db:
                        db.execute("INSERT OR REPLACE INTO worker_snapshot VALUES (?,?)",(self.account,json.dumps({"state":"unavailable","checkedAt":time.time(),"reason":"Broker or storage unavailable","nextRun":time.time()+30})))
                        db.commit()
                except Exception:
                    pass
            self.stop.wait(30)

    def status(self):
        with closing(sqlite3.connect(self.path)) as db:
            row=db.execute("SELECT payload FROM worker_snapshot WHERE account=?",(self.account,)).fetchone()
            count=db.execute("SELECT COUNT(*) FROM broker_deals WHERE account=?",(self.account,)).fetchone()[0]
        data=json.loads(row[0]) if row else {"state":"starting"}
        if data.get("checkedAt") and time.time()-data["checkedAt"]>120:
            data["state"]="stale"
        return {**data,"workerAlive":self.thread.is_alive(),"syncedDeals":count}

    def shutdown(self):
        self.stop.set()
        self.thread.join(timeout=3)
