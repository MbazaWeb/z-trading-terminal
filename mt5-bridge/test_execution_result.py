import unittest
from types import SimpleNamespace as S
from execution_result import classify

class ExecutionResultTests(unittest.TestCase):
    mt5=S(TRADE_RETCODE_DONE=10009,TRADE_RETCODE_REJECT=10006,TRADE_RETCODE_INVALID_STOPS=10016,TRADE_RETCODE_MARKET_CLOSED=10018)
    def test_confirmed(self):
        self.assertEqual(classify(self.mt5,S(retcode=10009,deal=7)),"confirmed")
    def test_missing_deal(self):
        self.assertEqual(classify(self.mt5,S(retcode=10009,deal=0)),"uncertain")
    def test_missing_response(self):
        self.assertEqual(classify(self.mt5,None),"uncertain")
    def test_definitive_rejection(self):
        for code in (10006,10016,10018):
            self.assertEqual(classify(self.mt5,S(retcode=code,deal=0,order=0)),"rejected")
    def test_rejection_with_order(self):
        self.assertEqual(classify(self.mt5,S(retcode=10006,deal=0,order=8)),"uncertain")
    def test_timeout(self):
        self.assertEqual(classify(self.mt5,S(retcode=10012,deal=0,order=0)),"uncertain")
    def test_close_requires_readback(self):
        self.assertEqual(classify(self.mt5,S(retcode=10009,deal=7),verified=False),"uncertain")
    def test_modify_requires_readback(self):
        for verified,expected in ((True,"confirmed"),(False,"uncertain")):
            self.assertEqual(classify(self.mt5,S(retcode=10009,deal=0),verified=verified,require_deal=False),expected)
