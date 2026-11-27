import unittest
from io import BytesIO
from openpyxl import load_workbook
from pypdf import PdfReader
from report_export import render

def fixture():
    m=dict(trades=1,wins=0,losses=1,net=-7,winRate=0,profitFactor=0)
    return dict(currency="USD",all=m,managed=m,byStrategy={"trend":m},positions=[dict(positionId="12345678901234567890",symbol="EURUSD",strategy="trend",openedAt=1700000000000,closedAt=1700000900000,net=-7,commission=-2,swap=0,fees=0,exitLabel="Stop loss")],agentEvents=[dict(created=1700000000,symbol="EURUSD",status="rejected",reason="Invalid stops < & >"),dict(created=1700000001,symbol="=1+1",status="uncertain",reason="No response")],recommendations=["Review demo evidence"],excluded=1)

class ReportTests(unittest.TestCase):
    def workbook(self,r=None):
        return load_workbook(BytesIO(render(r or fixture(),"xlsx")))
    def test_sheets(self):
        self.assertEqual(self.workbook().sheetnames,["Summary","Closed positions","Agent events","Suggested improvements"])
    def test_numeric_accounting(self):
        w=self.workbook()
        self.assertEqual(w["Summary"]["E2"].value,-7)
        self.assertEqual(w["Closed positions"]["G2"].value,-2)
        self.assertEqual(w["Closed positions"]["F2"].value,-7)
    def test_ticket_precision(self):
        self.assertEqual(self.workbook()["Closed positions"]["A2"].value,"12345678901234567890")
    def test_formula_injection(self):
        c=self.workbook()["Agent events"]["B3"]
        self.assertEqual(c.data_type,"s")
        self.assertEqual(c.value,"=1+1")
    def test_pdf_content(self):
        pdf=PdfReader(BytesIO(render(fixture(),"pdf")))
        text=" ".join(p.extract_text() for p in pdf.pages)
        for expected in ("EURUSD","Stop loss","Invalid stops","Review demo evidence","-7"):
            self.assertIn(expected,text)
    def test_empty_history(self):
        r=fixture();r["positions"]=[];r["agentEvents"]=[]
        self.assertEqual(self.workbook(r)["Closed positions"].max_row,1)
        self.assertGreater(len(PdfReader(BytesIO(render(r,"pdf"))).pages),0)
    def test_long_reason(self):
        r=fixture();r["agentEvents"][0]["reason"]="Broker validation detail "*1500
        self.assertGreater(len(PdfReader(BytesIO(render(r,"pdf"))).pages),1)
    def test_invalid_format(self):
        with self.assertRaises(ValueError): render(fixture(),"csv")
