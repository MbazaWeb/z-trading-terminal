import unittest
import sqlite3
from types import SimpleNamespace as S
from risk import check_portfolio
from reconciliation import schema, record, reconcile

class Broker:
    DEAL_TYPE_BUY=0
    DEAL_TYPE_SELL=1
    DEAL_ENTRY_IN=0
    DEAL_ENTRY_OUT=1
    POSITION_TYPE_BUY=0
    ORDER_TYPE_BUY=0
    ORDER_TYPE_SELL=1
    def __init__(self):
        self.positions=[]
        self.orders=[]
        self.deals=[]
    def positions_get(self,ticket=None):
        return self.positions if ticket is None or self.positions is None else [p for p in self.positions if p.ticket==ticket]
    def orders_get(self): return self.orders
    def history_deals_get(self,*args): return self.deals
    def order_calc_profit(self,*args): return -15

class RiskTests(unittest.TestCase):
    def setUp(self):
        self.b=Broker()
        self.a=S(balance=1000,equity=1000,profit=0)
    def check(self,loss=5): return check_portfolio(self.b,self.a,"EURUSD",loss)
    def test_safe(self): self.assertIsNone(self.check())
    def test_missing_data(self):
        self.b.positions=None
        self.assertIn("unavailable",self.check())
    def test_pending(self):
        self.b.orders=[1]
        self.assertIn("pending",self.check())
    def test_limit(self):
        self.b.positions=[1,2,3]
        self.assertIn("limit",self.check())
    def test_duplicate(self):
        self.b.positions=[S(symbol="EURUSD")]
        self.assertIn("Existing position",self.check())
    def test_daily_loss(self):
        self.a.profit=-10
        self.assertIn("Daily loss",self.check())
    def test_commission(self):
        self.b.deals=[S(type=0,profit=-8,commission=-2,swap=0,fee=0)]
        self.assertIn("Daily loss",self.check())
    def test_no_stop(self):
        self.b.positions=[S(symbol="GBPUSD",sl=0)]
        self.assertIn("no stop",self.check())
    def test_aggregate(self):
        self.b.positions=[S(symbol="GBPUSD",sl=1,type=0,volume=.01,price_current=2)]
        self.assertIn("Aggregate",self.check(6))

class ReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(":memory:")
        schema(self.db)
        self.b=Broker()
        self.a=S(login=123,server="Demo")
    def tearDown(self): self.db.close()
    def seed(self,kind="open"):
        self.db.execute("INSERT INTO requests VALUES ('r','pending')")
        req=dict(symbol="EURUSD",comment="ZT unique",volume=.01,type=0,sl=1,tp=2)
        if kind!="open": req["position"]=42
        record(self.db,S(request_id="r",login=123,server="Demo"),req,kind)
        self.db.commit()
    def status(self):
        reconcile(self.b,self.db,self.a)
        return self.db.execute("SELECT status FROM requests WHERE id='r'").fetchone()[0]
    def deal(self,entry=0,comment="ZT unique"):
        return S(comment=comment,symbol="EURUSD",magic=260427,type=0,entry=entry,volume=.01,ticket=7)
    def test_missing_evidence(self):
        self.seed()
        self.assertEqual(self.status(),"pending")
    def test_matching_entry(self):
        self.seed()
        self.b.deals=[self.deal()]
        self.assertEqual(self.status(),"reconciled")
    def test_wrong_comment(self):
        self.seed()
        self.b.deals=[self.deal(comment="other")]
        self.assertEqual(self.status(),"pending")
    def test_ambiguous(self):
        self.seed()
        self.b.deals=[self.deal(),self.deal()]
        self.assertEqual(self.status(),"pending")
    def test_wrong_account(self):
        self.seed()
        self.a.login=456
        self.b.deals=[self.deal()]
        self.assertEqual(self.status(),"pending")
    def test_close_requires_absence(self):
        self.seed("close")
        self.b.deals=[self.deal(entry=1)]
        self.b.positions=[S(ticket=42)]
        self.assertEqual(self.status(),"pending")
        self.b.positions=[]
        self.assertEqual(self.status(),"reconciled")
    def test_modify_readback(self):
        self.seed("modify")
        self.b.positions=[S(ticket=42,symbol="EURUSD",sl=1,tp=2)]
        self.assertEqual(self.status(),"reconciled")
    def test_legacy_stays_pending(self):
        self.db.execute("INSERT INTO requests VALUES ('r','pending')")
        self.assertEqual(self.status(),"pending")

if __name__=="__main__": unittest.main()
