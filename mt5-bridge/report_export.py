"""Generate actual XLSX and PDF from the same broker report."""
from io import BytesIO
from datetime import datetime, timezone

def stamp(ms):
    return datetime.fromtimestamp(ms/1000,timezone.utc).isoformat()

def tables(report):
    yield "Summary",["Scope","Trades","Wins","Losses","Net "+report["currency"],"Win %","Profit factor"],[[name,m["trades"],m["wins"],m["losses"],m["net"],m["winRate"],m["profitFactor"]] for name,m in [("All",report["all"]),("Managed",report["managed"]),*report["byStrategy"].items()]]
    yield "Closed positions",["Position","Market","Strategy","Opened UTC","Closed UTC","Net","Commission","Swap","Fees","Broker exit"],[[p["positionId"],p["symbol"],p["strategy"],stamp(p["openedAt"]),stamp(p["closedAt"]),p["net"],p["commission"],p["swap"],p["fees"],p["exitLabel"]] for p in report["positions"]]
    yield "Agent events",["Time UTC","Market","Status","Strategy","Reason"],[[stamp(e["created"]*1000),e.get("symbol",e.get("candidate",{}).get("symbol","")),e.get("status"),e.get("candidate",{}).get("signal",{}).get("strategy","Unattributed"),e.get("reason") or "; ".join(s["reason"] for s in e.get("stages",[]) if s["status"] in ("reject","blocked","uncertain"))] for e in report["agentEvents"]]
    yield "Suggested improvements",["Recommendation"],[[x] for x in report["recommendations"]]+[["Excluded incomplete or complex histories: "+str(report["excluded"])],["Broker exit reason is not proof of strategy failure."]]

def render(report,fmt):
    out=BytesIO()
    if fmt=="xlsx":
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill
        from openpyxl.utils import get_column_letter
        wb=Workbook();wb.remove(wb.active)
        for name,headers,rows in tables(report):
            ws=wb.create_sheet(name)
            for row in [headers,*rows]:
                ws.append(row)
                for cell in ws[ws.max_row]:
                    if isinstance(cell.value,str): cell.data_type="s"
            for cell in ws[1]:
                cell.font=Font(bold=True,color="FFFFFF")
                cell.fill=PatternFill("solid",fgColor="17365D")
            ws.freeze_panes="A2";ws.auto_filter.ref=ws.dimensions
            for i,h in enumerate(headers,1): ws.column_dimensions[get_column_letter(i)].width=max(18,min(40,len(h)+8))
        wb.save(out)
    else:
        from reportlab.platypus import SimpleDocTemplate, Paragraph, LongTable, TableStyle, Spacer
        from reportlab.lib.pagesizes import A3, landscape
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib import colors
        from xml.sax.saxutils import escape
        styles=getSampleStyleSheet()
        story=[Paragraph("MT5 demo trading report — last 30 days",styles["Title"])]
        for name,headers,rows in tables(report):
            story.append(Paragraph(name,styles["Heading2"]))
            def cell(v): return Paragraph(escape(str(v if v is not None else "—")),styles["BodyText"])
            table=LongTable([[cell(v) for v in row] for row in [headers,*rows]],repeatRows=1,colWidths=[1100/len(headers)]*len(headers))
            table.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),colors.lightgrey),("VALIGN",(0,0),(-1,-1),"TOP"),("GRID",(0,0),(-1,-1),.25,colors.grey)]))
            story.extend([table,Spacer(1,12)])
        SimpleDocTemplate(out,pagesize=landscape(A3),leftMargin=35,rightMargin=35).build(story)
    return out.getvalue()
