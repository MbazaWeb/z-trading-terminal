import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from reconciliation import match_deals

class ReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.request = uuid4()
        self.deal = SimpleNamespace(comment=self.request.hex[:24], symbol="EURUSD", type=0, entry=0, ticket=123)

    def match(self, deals):
        return match_deals(str(self.request), deals, expected_symbol="EURUSD", expected_type=0)

    def test_unique(self):
        self.assertEqual(self.match([self.deal]), {"status":"candidate","dealId":"123"})

    def test_unavailable(self):
        self.assertEqual(self.match(None)["status"], "history_unavailable")

    def test_missing(self):
        self.assertEqual(self.match([])["status"], "unresolved")

    def test_multiple(self):
        self.assertEqual(self.match([self.deal,self.deal])["status"], "ambiguous")

    def test_wrong_symbol(self):
        self.deal.symbol = "GBPUSD"
        self.assertEqual(self.match([self.deal])["status"], "ambiguous")

    def test_wrong_direction(self):
        self.deal.type = 1
        self.assertEqual(self.match([self.deal])["status"], "ambiguous")

    def test_exit_deal(self):
        self.deal.entry = 1
        self.assertEqual(self.match([self.deal])["status"], "ambiguous")

    def test_invalid_ticket(self):
        self.deal.ticket = 0
        self.assertEqual(self.match([self.deal])["status"], "ambiguous")
