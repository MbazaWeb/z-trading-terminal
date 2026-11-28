import sys
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from request_ledger import reserve_request, record_outcome

class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "ledger.sqlite"
        self.request = str(uuid4())

    def reserve(self, request=None, account="demo-test"):
        reserve_request(self.path, request or self.request, account, "test-fingerprint")

    def test_duplicate_request_blocked(self):
        self.reserve()
        with self.assertRaises(RuntimeError):
            self.reserve()

    def test_unresolved_blocks_new_request(self):
        self.reserve()
        with self.assertRaises(RuntimeError):
            self.reserve(str(uuid4()))

    def test_unknown_blocks_new_request(self):
        self.reserve()
        record_outcome(self.path, self.request, None)
        with self.assertRaises(RuntimeError):
            self.reserve(str(uuid4()))

    def test_confirmed_releases_account_reservation(self):
        self.reserve()
        record_outcome(self.path, self.request, "broker-test-id")
        self.reserve(str(uuid4()))

    def test_confirmed_request_cannot_be_replayed(self):
        self.reserve()
        record_outcome(self.path, self.request, "broker-test-id")
        with self.assertRaises(RuntimeError):
            self.reserve()

    def test_other_account_not_blocked(self):
        self.reserve()
        self.reserve(str(uuid4()), "other-demo-test")

if __name__ == "__main__":
    unittest.main()
