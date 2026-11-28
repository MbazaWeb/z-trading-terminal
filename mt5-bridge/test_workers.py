import unittest
import tempfile
import time
import threading
import sqlite3
import json
from pathlib import Path
from contextlib import closing
from bot_scheduler import Bot
from maintenance_worker import MaintenanceWorker

class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path=str(Path(self.tmp.name)/"test.sqlite")
    def wait(self,predicate):
        deadline=time.monotonic()+3
        while time.monotonic()<deadline:
            if predicate(): return
            time.sleep(.01)
        self.fail("Worker did not reach expected state")
    def bot(self,execute):
        b=Bot(execute,self.path,"demo")
        self.addCleanup(b.shutdown)
        return b
    def test_default_stopped(self):
        b=self.bot(lambda _:self.fail("Unexpected execution"))
        self.assertFalse(b.allowed())
    def test_start_stop(self):
        called=threading.Event()
        b=self.bot(lambda _: (called.set() or {"outcomes":[]}))
        b.control("start",{})
        self.assertTrue(called.wait(3))
        self.wait(lambda:not b.snapshot()["busy"])
        b.control("stop")
        self.assertFalse(b.allowed())
    def test_uncertain_pauses(self):
        b=self.bot(lambda _:{"outcomes":[{"status":"uncertain"}]})
        b.control("start",{})
        self.wait(lambda:b.snapshot()["state"]=="paused")
        self.assertFalse(b.allowed())
    def test_exception_pauses(self):
        def fail(_): raise RuntimeError("test")
        b=self.bot(fail)
        b.control("start",{})
        self.wait(lambda:b.snapshot()["state"]=="paused")
    def test_restart_stopped(self):
        b=self.bot(lambda _:{"outcomes":[]})
        b.control("start",{})
        b.shutdown()
        c=self.bot(lambda _:self.fail("Unexpected restart execution"))
        self.assertEqual(c.snapshot()["state"],"stopped")
        self.assertTrue(any(e["type"]=="start" for e in c.snapshot()["events"]))
    def worker(self,collect):
        w=MaintenanceWorker(self.path,"demo",collect)
        def cleanup():
            w.shutdown()
        self.addCleanup(cleanup)
        return w
    def test_deal_dedup(self):
        w=self.worker(lambda:({},[{"ticket":"1"},{"ticket":"1"}]))
        self.wait(lambda:w.status()["state"]=="healthy")
        self.assertEqual(w.status()["syncedDeals"],1)
    def test_collect_failure(self):
        def fail(): raise RuntimeError("test")
        w=self.worker(fail)
        self.wait(lambda:w.status()["state"]=="unavailable")
    def test_stale_snapshot(self):
        w=self.worker(lambda:({},[]))
        self.wait(lambda:w.status()["state"]=="healthy")
        with closing(sqlite3.connect(self.path)) as db:
            db.execute("UPDATE worker_snapshot SET payload=?",(json.dumps({"state":"healthy","checkedAt":time.time()-121}),))
            db.commit()
        self.assertEqual(w.status()["state"],"stale")
