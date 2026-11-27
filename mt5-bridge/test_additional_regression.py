import unittest
import sqlite3
from types import SimpleNamespace as S
from test_regression import Broker
from risk import check_portfolio
from performance_agent import summarize

class AdditionalRiskTests(unittest.TestCase):
    def test_invalid_loss(self):
        for loss in (0,-1,float("nan"),float("inf")):
            with self.subTest(loss=loss):
                self.assertIsNotNone(check_portfolio(Broker(),S(balance=1000,equity=1000,profit=0),"EURUSD",loss))
    def test_invalid_equity(self):
        for equity in (0,-1,float("nan"),float("inf")):
            self.assertIsNotNone(check_portfolio(Broker(),S(balance=1000,equity=equity,profit=0),"EURUSD",5))
    def test_invalid_history(self):
        b=Broker()
        b.deals=[S(type=0,profit=float("nan"),commission=0,swap=0,fee=0)]
        self.assertIsNotNone(check_portfolio(b,S(balance=1000,equity=1000,profit=0),"EURUSD",5))

class SettlementTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.account=S(login=123,server="Demo")
    def deal(self,entry,ticket,profit=0,volume=.01):
        return S(type=entry,entry=entry,ticket=ticket,position_id=42,time_msc=ticket*1000,volume=volume,profit=profit,commission=-1,swap=0,fee=0,reason=0,magic=260427,symbol="EURUSD")
    def report(self,deals):
        return summarize(Broker(),deals,self.db,self.account)
    def test_empty(self):
        self.assertEqual(self.report([])["all"]["trades"],0)
    def test_net_includes_commission(self):
        r=self.report([self.deal(0,1),self.deal(1,2,10)])
        self.assertEqual(r["managed"]["net"],8)
        self.assertEqual(r["managed"]["wins"],1)
    def test_incomplete_excluded(self):
        r=self.report([self.deal(0,1),self.deal(1,2,10,.005)])
        self.assertEqual(r["all"]["trades"],0)
        self.assertEqual(r["excluded"],1)
    def test_loss(self):
        r=self.report([self.deal(0,1),self.deal(1,2,-5)])
        self.assertEqual(r["managed"]["losses"],1)
        self.assertEqual(r["managed"]["net"],-7)

if __name__=="__main__": unittest.main()
