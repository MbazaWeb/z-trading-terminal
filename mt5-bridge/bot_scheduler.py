"""Single-process scheduler with durable audit and fail-closed recovery."""
import threading
import time
import sqlite3
import json
from collections import deque

class Bot:
    def __init__(self, execute, path, account_key):
        self.execute=execute
        self.path=path
        self.account_key=account_key
        self.guard=threading.RLock()
        self.wake=threading.Event()
        self.state="stopped"
        self.config=None
        self.busy=False
        self.started=None
        self.heartbeat=time.time()
        self.events=deque(maxlen=100)
        with sqlite3.connect(path) as db:
            db.execute("CREATE TABLE IF NOT EXISTS bot_audit (seq INTEGER PRIMARY KEY, account TEXT, payload TEXT)")
            db.execute("CREATE TABLE IF NOT EXISTS bot_state (account TEXT PRIMARY KEY, state TEXT)")
            previous=db.execute("SELECT state FROM bot_state WHERE account=?",(account_key,)).fetchone()
            for (payload,) in db.execute("SELECT payload FROM bot_audit WHERE account=? ORDER BY seq DESC LIMIT 100",(account_key,)):
                self.events.append(json.loads(payload))
        self.record({"type":"restart","message":"Bridge restarted; explicit start required","previousState":previous[0] if previous else None})
        self.thread=threading.Thread(target=self.loop,daemon=True,name="demo-bot")
        self.thread.start()
        threading.Thread(target=self.watchdog,daemon=True,name="demo-watchdog").start()

    def record(self,event):
        event={"time":time.time(),**event}
        with sqlite3.connect(self.path) as db:
            db.execute("INSERT INTO bot_audit(account,payload) VALUES (?,?)",(self.account_key,json.dumps(event)))
            db.execute("INSERT OR REPLACE INTO bot_state VALUES (?,?)",(self.account_key,self.state))
        self.events.appendleft(event)

    def allowed(self):
        with self.guard:
            return self.state=="running"

    def control(self, action, config=None):
        with self.guard:
            if action=="start":
                if self.busy or self.state=="running" or not self.thread.is_alive(): raise ValueError("Bot unavailable or active")
                self.config=config
                self.state="running"
            elif action=="pause": self.state="paused"
            elif action=="stop": self.state="stopped"
            else: raise ValueError("Invalid action")
            try: self.record({"type":action,"message":"Bot "+action})
            except Exception:
                self.state="stopped"
                raise
            self.wake.set()

    def snapshot(self):
        with self.guard:
            return {"state":self.state,"busy":self.busy,"events":list(self.events),"intervalSeconds":45,"heartbeat":self.heartbeat,"cycleStarted":self.started,"workerAlive":self.thread.is_alive()}

    def watchdog(self):
        while True:
            time.sleep(5)
            with self.guard:
                if self.state=="running" and (not self.thread.is_alive() or (self.busy and self.started and time.time()-self.started>120)):
                    self.state="paused"
                    try: self.record({"type":"watchdog","error":"Worker stalled; paused. Verify broker state before restart."})
                    except Exception: pass

    def loop(self):
        while True:
            self.wake.wait(45)
            self.wake.clear()
            with self.guard:
                self.heartbeat=time.time()
                if self.state!="running" or self.busy: continue
                self.busy=True
                self.started=time.time()
                config=self.config
            try:
                result=self.execute(config)
                with self.guard:
                    if self.state=="running" and any(x.get("status")=="uncertain" for x in result.get("outcomes",[])):
                        self.state="paused"
                    self.record({"type":"cycle","result":result})
            except Exception as e:
                with self.guard:
                    if self.state=="running": self.state="paused"
                    try: self.record({"type":"failure","error":str(getattr(e,"detail","Bot cycle failed"))})
                    except Exception: pass
            finally:
                with self.guard:
                    self.busy=False
                    self.started=None
                    self.heartbeat=time.time()
