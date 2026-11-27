import unittest
import time
from types import SimpleNamespace as S
from strategy_engine import evaluate
from agents import assess
from test_regression import Broker

STRATEGIES=("ensemble","ma","bollinger","rsi","macd","trend","reversion","breakout")
def candles(direction=1):
    return [dict(time=900*i,open=100+direction*i*.1,close=100+direction*i*.1,high=100+direction*i*.1+.02,low=100+direction*i*.1-.02) for i in range(150)]

class StrategyTests(unittest.TestCase):
    def test_all_strategies(self):
        for name in STRATEGIES:
            for direction in (-1,1):
                with self.subTest(name=name,direction=direction):
                    r=evaluate(candles(direction),name)
                    self.assertEqual(r,evaluate(candles(direction),name))
                    self.assertIn(r["side"],("BUY","SELL","HOLD"))
                    if r["side"]=="BUY": self.assertLess(r["sl"],r["referencePrice"]); self.assertGreater(r["tp"],r["referencePrice"])
                    if r["side"]=="SELL": self.assertGreater(r["sl"],r["referencePrice"]); self.assertLess(r["tp"],r["referencePrice"])
    def test_trend_direction(self):
        self.assertEqual(evaluate(candles(),"trend")["side"],"BUY")
        self.assertEqual(evaluate(candles(-1),"trend")["side"],"SELL")
    def test_short_history(self):
        self.assertEqual(evaluate(candles()[:10])["side"],"HOLD")
    def test_duplicate_time(self):
        c=candles();c[-1]["time"]=c[-2]["time"]
        self.assertEqual(evaluate(c)["side"],"HOLD")
    def test_missing_field(self):
        c=candles();del c[-1]["close"]
        self.assertEqual(evaluate(c)["side"],"HOLD")
    def test_nan(self):
        c=candles();c[-1]["close"]=float("nan")
        self.assertEqual(evaluate(c)["side"],"HOLD")
    def test_invalid_config(self):
        with self.assertRaises(ValueError): evaluate(candles(),fast=30,slow=10)

class AgentTests(unittest.TestCase):
    def setUp(self):
        self.b=Broker()
        self.a=S(balance=1000,equity=1000,profit=0)
        self.b.symbol_info_tick=lambda _:S(time=time.time(),bid=100,ask=100.1)
        self.b.symbol_info=lambda _:S(volume_min=.01)
        self.b.order_calc_profit=lambda *args:-5
        self.s=dict(symbol="EURUSD",side="BUY",reason="Test signal",frames={"15m":{},"1H":{}},sl=99,tp=102)
    def decision(self): return assess(self.b,self.a,[self.s])[0]
    def test_candidate_read_only(self):
        r=self.decision()
        self.assertEqual(r["decision"],"CANDIDATE")
        self.assertEqual(r["stages"][-1]["status"],"skip")
    def test_missing_frames(self):
        del self.s["frames"]
        self.assertEqual(self.decision()["decision"],"HOLD")
    def test_stale_quote(self):
        self.b.symbol_info_tick=lambda _:S(time=time.time()-100,bid=100,ask=100.1)
        self.assertEqual(self.decision()["decision"],"HOLD")
    def test_excess_risk(self):
        self.b.order_calc_profit=lambda *args:-20
        self.assertEqual(self.decision()["decision"],"HOLD")
    def test_bad_stop(self):
        self.s["sl"]=101
        self.assertEqual(self.decision()["decision"],"HOLD")
