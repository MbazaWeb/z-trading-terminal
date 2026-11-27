import os
import secrets
import threading
from datetime import datetime, timedelta, timezone
import MetaTrader5 as mt5
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, SecretStr, Field

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
lock = threading.Lock()

class Credentials(BaseModel):
    login: int = Field(gt=0)
    password: SecretStr
    server: str = Field(min_length=1, max_length=128)

@app.post("/verify")
def verify(body: Credentials, authorization: str = Header(default="")):
    key = os.environ.get("MT5_BRIDGE_KEY", "")
    if len(key) < 32 or not secrets.compare_digest(authorization, "Bearer " + key):
        raise HTTPException(401, "Unauthorized")
    with lock:
        try:
            if not mt5.initialize(login=body.login, password=body.password.get_secret_value(), server=body.server, timeout=15000):
                raise HTTPException(502, "MT5 connection failed")
            account = mt5.account_info()
            terminal = mt5.terminal_info()
            if account is None or terminal is None or not terminal.connected or account.login != body.login or account.server != body.server:
                raise HTTPException(502, "Account verification failed")
            if account.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO:
                raise HTTPException(403, "Only demo accounts are supported in this phase")
            return {"loginid": str(account.login), "accountType": "demo", "currency": account.currency,
                    "balance": account.balance, "equity": account.equity, "freeMargin": account.margin_free,
                    "leverage": account.leverage, "server": account.server, "name": account.name, "email": ""}
        finally:
            mt5.shutdown()

# Public market information only, from a dedicated preconfigured demo terminal.
@app.get("/market")
def market(symbol: str = "", timeframe: str = "15m", authorization: str = Header(default="")):
    key = os.environ.get("MT5_BRIDGE_KEY", "")
    if len(key) < 32 or not secrets.compare_digest(authorization, "Bearer " + key):
        raise HTTPException(401, "Unauthorized")
    frames = {"1m": mt5.TIMEFRAME_M1, "5m": mt5.TIMEFRAME_M5, "15m": mt5.TIMEFRAME_M15,
              "1H": mt5.TIMEFRAME_H1, "4H": mt5.TIMEFRAME_H4, "1D": mt5.TIMEFRAME_D1, "1W": mt5.TIMEFRAME_W1}
    if timeframe not in frames or len(symbol) > 128:
        raise HTTPException(400, "Invalid market request")
    with lock:
        try:
            if not mt5.initialize(timeout=15000):
                raise HTTPException(503, "Terminal unavailable")
            account, terminal = mt5.account_info(), mt5.terminal_info()
            if not account or not terminal or not terminal.connected or account.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO:
                raise HTTPException(503, "Demo feed unavailable")
            instruments = mt5.symbols_get()
            if instruments is None:
                raise HTTPException(503, "Symbols unavailable")
            symbols = [{"id": s.name, "name": s.description, "base": s.currency_base,
                        "quote": s.currency_profit, "digits": s.digits, "point": s.point}
                       for s in instruments if s.visible]
            if not symbols:
                raise HTTPException(503, "No Market Watch symbols")
            selected = symbol or symbols[0]["id"]
            if selected not in {s["id"] for s in symbols}:
                raise HTTPException(404, "Symbol not in Market Watch")
            tick = mt5.symbol_info_tick(selected)
            rates = mt5.copy_rates_from_pos(selected, frames[timeframe], 0, 150)
            if tick is None or rates is None or len(rates) == 0 or tick.bid <= 0 or tick.ask <= 0:
                raise HTTPException(503, "Quote or candles unavailable")
            return {"source": "MT5", "symbols": symbols, "symbol": selected, "timeframe": timeframe,
                    "quote": {"bid": tick.bid, "ask": tick.ask, "time": tick.time_msc},
                    "candles": [{"time": int(r["time"]) * 1000, "open": float(r["open"]),
                                 "high": float(r["high"]), "low": float(r["low"]),
                                 "close": float(r["close"]), "tickVolume": int(r["tick_volume"])} for r in rates]}
        finally:
            mt5.shutdown()

@app.get("/account")
def account_snapshot(login: int, server: str, authorization: str = Header(default="")):
    key = os.environ.get("MT5_BRIDGE_KEY", "")
    if len(key) < 32 or not secrets.compare_digest(authorization, "Bearer " + key):
        raise HTTPException(401, "Unauthorized")
    with lock:
        try:
            if not mt5.initialize(timeout=15000):
                raise HTTPException(503, "Terminal unavailable")
            a, t = mt5.account_info(), mt5.terminal_info()
            if not a or not t or not t.connected or a.login != login or a.server != server or a.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO:
                raise HTTPException(403, "Verified account not connected")
            positions = mt5.positions_get()
            now = datetime.now(timezone.utc)
            deals = mt5.history_deals_get(now - timedelta(days=30), now)
            if positions is None or deals is None:
                raise HTTPException(503, "Account history unavailable")
            return {"loginid": str(a.login), "server": a.server, "currency": a.currency,
                    "balance": a.balance, "equity": a.equity, "margin": a.margin,
                    "freeMargin": a.margin_free, "profit": a.profit, "leverage": a.leverage,
                    "asOf": now.isoformat(),
                    "positions": [{"ticket": str(p.ticket), "symbol": p.symbol,
                                   "side": "Buy" if p.type == mt5.POSITION_TYPE_BUY else "Sell",
                                   "volume": p.volume, "open": p.price_open, "current": p.price_current,
                                   "profit": p.profit, "swap": p.swap, "sl": p.sl, "tp": p.tp} for p in positions],
                    "deals": [{"ticket": str(d.ticket), "symbol": d.symbol, "time": d.time,
                               "entry": d.entry, "type": d.type, "volume": d.volume,
                               "profit": d.profit, "commission": d.commission, "swap": d.swap, "fee": d.fee}
                              for d in deals if d.type in (mt5.DEAL_TYPE_BUY, mt5.DEAL_TYPE_SELL)]}
        finally:
            mt5.shutdown()

# Demo execution is opt-in and restricted to a dedicated account.
from risk import check_portfolio
from risk import check_portfolio
from reconciliation import record, reconcile
import sqlite3
import math
import time
from typing import Literal
from uuid import UUID

class OrderRequest(BaseModel):
    login: int
    server: str
    request_id: UUID
    symbol: str = Field(min_length=1,max_length=128)
    side: Literal["buy","sell"]
    volume: float = Field(gt=0,le=0.01)
    sl: float = Field(gt=0)
    tp: float = Field(gt=0)

@app.post("/order")
def order(body: OrderRequest, authorization: str = Header(default="")):
    key = os.environ.get("MT5_BRIDGE_KEY","")
    if len(key)<32 or not secrets.compare_digest(authorization,"Bearer "+key):
        raise HTTPException(401,"Unauthorized")
    if os.environ.get("MT5_DEMO_EXECUTION")!="true" or str(body.login)!=os.environ.get("MT5_EXECUTION_LOGIN") or body.server!=os.environ.get("MT5_EXECUTION_SERVER"):
        raise HTTPException(403,"Demo execution disabled or account not allowed")
    if not all(math.isfinite(x) for x in (body.volume,body.sl,body.tp)):
        raise HTTPException(400,"Invalid numbers")
    with lock:
        try:
            if not mt5.initialize(timeout=15000):
                raise HTTPException(503,"Terminal unavailable")
            a,t=mt5.account_info(),mt5.terminal_info()
            if not a or not t or not t.connected or not t.trade_allowed or not a.trade_allowed or not a.trade_expert or a.login!=body.login or a.server!=body.server or a.trade_mode!=mt5.ACCOUNT_TRADE_MODE_DEMO:
                raise HTTPException(403,"Demo account not ready")
            s=mt5.symbol_info(body.symbol)
            q=mt5.symbol_info_tick(body.symbol)
            if not s or not s.visible or not q or not (0<=time.time()-q.time<=30) or q.bid<=0 or q.ask<q.bid:
                raise HTTPException(400,"Fresh market quote unavailable")
            if s.trade_mode!=mt5.SYMBOL_TRADE_MODE_FULL or not s.volume_step or not s.volume_min<=body.volume<=s.volume_max or abs(body.volume/s.volume_step-round(body.volume/s.volume_step))>1e-7:
                raise HTTPException(400,"Symbol or lot size not supported")
            buy=body.side=="buy"
            price=q.ask if buy else q.bid
            distance=max(s.trade_stops_level*s.point,s.point)
            if not ((body.sl<=q.bid-distance and body.tp>=price+distance) if buy else (body.sl>=q.ask+distance and body.tp<=price-distance)):
                raise HTTPException(400,"Invalid stop loss or take profit")
            typ=mt5.ORDER_TYPE_BUY if buy else mt5.ORDER_TYPE_SELL
            margin=mt5.order_calc_margin(typ,body.symbol,body.volume,price)
            loss=mt5.order_calc_profit(typ,body.symbol,body.volume,price,body.sl)
            if margin is None or loss is None or a.equity<=0 or margin>a.margin_free or loss>=0 or -loss>a.equity*0.01:
                raise HTTPException(400,"Margin or 1% estimated risk limit exceeded")
            reason = check_portfolio(mt5, a, -loss)
            if reason:
                raise HTTPException(403, reason)
            if os.path.exists(os.environ.get("MT5_STOP_FILE","STOP_TRADING")):
                raise HTTPException(403,"Emergency stop active")
            risk_error = check_portfolio(mt5,a,body.symbol,-loss)
            if risk_error:
                raise HTTPException(400,risk_error)
            # FOK only: do not silently switch execution policy.
            if not (s.filling_mode & 1):
                raise HTTPException(400,"FOK filling not supported")
            req={"action":mt5.TRADE_ACTION_DEAL,"symbol":body.symbol,"volume":body.volume,"type":typ,"price":price,"sl":body.sl,"tp":body.tp,"deviation":10,"magic":260427,"comment":"ZT "+body.request_id.hex[:20],"type_filling":mt5.ORDER_FILLING_FOK,"type_time":mt5.ORDER_TIME_GTC}
            check=mt5.order_check(req)
            if check is None or check.retcode!=0:
                raise HTTPException(400,"Broker preflight rejected")
            # Persist before sending; uncertain outcomes are never retried automatically.
            with sqlite3.connect(os.environ.get("MT5_ORDER_DB","mt5-orders.sqlite3")) as db:
                db.execute("CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, status TEXT NOT NULL)")
                if db.execute("SELECT 1 FROM requests WHERE status IN ('pending','uncertain') LIMIT 1").fetchone():
                    raise HTTPException(409,"Unresolved order exists; reconcile broker history before further entries")
                try:
                    db.execute("INSERT INTO requests VALUES (?,?)",(str(body.request_id),"pending"))
                    record(db,body,req,"open")
                    db.commit()
                except sqlite3.IntegrityError:
                    raise HTTPException(409,"Duplicate request; reconcile broker history")
                if os.path.exists(os.environ.get("MT5_STOP_FILE","STOP_TRADING")):
                    raise HTTPException(403,"Emergency stop active")
                result=mt5.order_send(req)
                status="confirmed" if result is not None and result.retcode==mt5.TRADE_RETCODE_DONE and result.deal else "uncertain"
                db.execute("UPDATE requests SET status=? WHERE id=?",(status,str(body.request_id)))
                db.commit()
                return {"status":status,"requestId":str(body.request_id),"retcode":result.retcode if result else None,"deal":str(result.deal) if result else None,"order":str(result.order) if result else None}
        finally:
            mt5.shutdown()

class CloseRequest(BaseModel):
    login: int
    server: str
    ticket: str = Field(pattern=r"^[1-9][0-9]{0,19}$")
    request_id: UUID

@app.post("/close")
def close_position(body: CloseRequest, authorization: str = Header(default="")):
    key = os.environ.get("MT5_BRIDGE_KEY","")
    if len(key)<32 or not secrets.compare_digest(authorization,"Bearer "+key):
        raise HTTPException(401,"Unauthorized")
    if os.environ.get("MT5_DEMO_EXECUTION")!="true" or str(body.login)!=os.environ.get("MT5_EXECUTION_LOGIN") or body.server!=os.environ.get("MT5_EXECUTION_SERVER"):
        raise HTTPException(403,"Demo execution disabled")
    with lock:
        try:
            if not mt5.initialize(timeout=15000):
                raise HTTPException(503,"Terminal unavailable")
            a,t=mt5.account_info(),mt5.terminal_info()
            if not a or not t or not t.connected or not t.trade_allowed or not a.trade_allowed or not a.trade_expert or a.login!=body.login or a.server!=body.server or a.trade_mode!=mt5.ACCOUNT_TRADE_MODE_DEMO:
                raise HTTPException(403,"Demo account not ready")
            positions=mt5.positions_get(ticket=int(body.ticket))
            if positions is None or len(positions)!=1:
                raise HTTPException(404,"Position unavailable")
            p=positions[0]
            s,q=mt5.symbol_info(p.symbol),mt5.symbol_info_tick(p.symbol)
            if not s or not q or not (0<=time.time()-q.time<=30) or q.bid<=0 or q.ask<q.bid or not (s.filling_mode & 1):
                raise HTTPException(400,"Fresh quote or FOK unavailable")
            buy=p.type==mt5.POSITION_TYPE_SELL
            req={"action":mt5.TRADE_ACTION_DEAL,"position":p.ticket,"symbol":p.symbol,"volume":p.volume,"type":mt5.ORDER_TYPE_BUY if buy else mt5.ORDER_TYPE_SELL,"price":q.ask if buy else q.bid,"deviation":10,"magic":260427,"comment":"ZT close "+body.request_id.hex[:16],"type_filling":mt5.ORDER_FILLING_FOK,"type_time":mt5.ORDER_TIME_GTC}
            check=mt5.order_check(req)
            if check is None or check.retcode!=0:
                raise HTTPException(400,"Close preflight rejected")
            with sqlite3.connect(os.environ.get("MT5_ORDER_DB","mt5-orders.sqlite3")) as db:
                db.execute("CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, status TEXT NOT NULL)")
                db.execute("CREATE TABLE IF NOT EXISTS close_requests (ticket TEXT PRIMARY KEY, id TEXT NOT NULL)")
                try:
                    db.execute("INSERT INTO requests VALUES (?,?)",(str(body.request_id),"pending"))
                    record(db,body,req,"close")
                    db.execute("INSERT INTO close_requests VALUES (?,?)",(str(p.ticket),str(body.request_id)))
                    db.commit()
                except sqlite3.IntegrityError:
                    raise HTTPException(409,"Close already requested; reconcile broker history")
                result=mt5.order_send(req)
                remaining=mt5.positions_get(ticket=p.ticket)
                status="confirmed" if result is not None and result.retcode==mt5.TRADE_RETCODE_DONE and result.deal and remaining is not None and len(remaining)==0 else "uncertain"
                db.execute("UPDATE requests SET status=? WHERE id=?",(status,str(body.request_id)))
                db.commit()
                return {"status":status,"requestId":str(body.request_id),"ticket":str(p.ticket),"deal":str(result.deal) if result else None,"retcode":result.retcode if result else None}
        finally:
            mt5.shutdown()

class ModifyRequest(CloseRequest):
    sl: float = Field(gt=0)
    tp: float = Field(gt=0)
    expected_sl: float = Field(ge=0)
    expected_tp: float = Field(ge=0)

@app.post("/modify")
def modify_position(body: ModifyRequest, authorization: str = Header(default="")):
    key=os.environ.get("MT5_BRIDGE_KEY","")
    if len(key)<32 or not secrets.compare_digest(authorization,"Bearer "+key):
        raise HTTPException(401,"Unauthorized")
    if os.environ.get("MT5_DEMO_EXECUTION")!="true" or str(body.login)!=os.environ.get("MT5_EXECUTION_LOGIN") or body.server!=os.environ.get("MT5_EXECUTION_SERVER"):
        raise HTTPException(403,"Demo execution disabled")
    if not all(math.isfinite(x) for x in (body.sl,body.tp,body.expected_sl,body.expected_tp)):
        raise HTTPException(400,"Invalid protective prices")
    with lock:
        try:
            if not mt5.initialize(timeout=15000):
                raise HTTPException(503,"Terminal unavailable")
            a,t=mt5.account_info(),mt5.terminal_info()
            if not a or not t or not t.connected or not t.trade_allowed or not a.trade_allowed or not a.trade_expert or a.login!=body.login or a.server!=body.server or a.trade_mode!=mt5.ACCOUNT_TRADE_MODE_DEMO:
                raise HTTPException(403,"Demo account not ready")
            positions=mt5.positions_get(ticket=int(body.ticket))
            if positions is None or len(positions)!=1:
                raise HTTPException(404,"Position unavailable")
            p=positions[0]
            s,q=mt5.symbol_info(p.symbol),mt5.symbol_info_tick(p.symbol)
            if not s or not q or not (0<=time.time()-q.time<=30) or q.bid<=0 or q.ask<q.bid or s.trade_tick_size<=0:
                raise HTTPException(400,"Fresh quote unavailable")
            if p.sl!=body.expected_sl or p.tp!=body.expected_tp:
                raise HTTPException(409,"Position changed; refresh before editing")
            buy=p.type==mt5.POSITION_TYPE_BUY
            price=q.bid if buy else q.ask
            distance=max(s.trade_stops_level,s.trade_freeze_level,1)*s.point
            for level in (body.sl,body.tp):
                if abs(level/s.trade_tick_size-round(level/s.trade_tick_size))>1e-6:
                    raise HTTPException(400,"Price does not match broker tick size")
            if not ((body.sl<=price-distance and body.tp>=price+distance) if buy else (body.sl>=price+distance and body.tp<=price-distance)):
                raise HTTPException(400,"Invalid stop or target distance")
            if p.sl>0 and ((buy and body.sl<p.sl) or (not buy and body.sl>p.sl)):
                raise HTTPException(400,"Stop widening prohibited")
            typ=mt5.ORDER_TYPE_BUY if buy else mt5.ORDER_TYPE_SELL
            loss=mt5.order_calc_profit(typ,p.symbol,p.volume,price,body.sl)
            if loss is None or not math.isfinite(loss) or a.equity<=0:
                raise HTTPException(400,"Risk calculation unavailable")
            if p.sl<=0 and -loss>a.equity*0.01:
                raise HTTPException(400,"New protective stop exceeds 1% estimated risk")
            req={"action":mt5.TRADE_ACTION_SLTP,"position":p.ticket,"symbol":p.symbol,"sl":body.sl,"tp":body.tp}
            with sqlite3.connect(os.environ.get("MT5_ORDER_DB","mt5-orders.sqlite3")) as db:
                db.execute("CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, status TEXT NOT NULL)")
                db.execute("CREATE TABLE IF NOT EXISTS modify_requests (ticket TEXT PRIMARY KEY, id TEXT NOT NULL)")
                try:
                    db.execute("INSERT INTO requests VALUES (?,?)",(str(body.request_id),"pending"))
                    record(db,body,req,"modify")
                    db.execute("INSERT INTO modify_requests VALUES (?,?)",(str(p.ticket),str(body.request_id)))
                    db.commit()
                except sqlite3.IntegrityError:
                    raise HTTPException(409,"Modification already requested; reconcile broker state")
                result=mt5.order_send(req)
                updated=mt5.positions_get(ticket=p.ticket)
                status="confirmed" if result is not None and result.retcode==mt5.TRADE_RETCODE_DONE and updated is not None and len(updated)==1 and abs(updated[0].sl-body.sl)<s.trade_tick_size/2 and abs(updated[0].tp-body.tp)<s.trade_tick_size/2 else "uncertain"
                db.execute("UPDATE requests SET status=? WHERE id=?",(status,str(body.request_id)))
                if status=="confirmed":
                    db.execute("DELETE FROM modify_requests WHERE ticket=?",(str(p.ticket),))
                db.commit()
                return {"status":status,"requestId":str(body.request_id),"ticket":str(p.ticket),"retcode":result.retcode if result else None}
        finally:
            mt5.shutdown()

def reconciliation_loop():
    while True:
        try:
            with lock:
                try:
                    if mt5.initialize(timeout=15000):
                        a,t=mt5.account_info(),mt5.terminal_info()
                        if a and t and t.connected and a.trade_mode==mt5.ACCOUNT_TRADE_MODE_DEMO and str(a.login)==os.environ.get("MT5_EXECUTION_LOGIN") and a.server==os.environ.get("MT5_EXECUTION_SERVER"):
                            with sqlite3.connect(os.environ.get("MT5_ORDER_DB","mt5-orders.sqlite3")) as db:
                                reconcile(mt5,db,a)
                finally:
                    mt5.shutdown()
        except Exception:
            import logging
            logging.exception("Reconciliation failed; unresolved requests remain blocked")
        time.sleep(30)

@app.on_event("startup")
def start_reconciliation():
    if os.environ.get("MT5_DEMO_EXECUTION")=="true":
        threading.Thread(target=reconciliation_loop,daemon=True,name="mt5-reconciliation").start()

from market_scanner import scan as scan_markets

class ScanRequest(BaseModel):
    login: int = Field(gt=0)
    server: str = Field(min_length=1,max_length=128)
    symbols: list[str] = Field(min_length=1,max_length=10)
    strategy: str = "ensemble"
    fast: int = Field(default=10,ge=2,le=99)
    slow: int = Field(default=30,ge=3,le=100)
    period: int = Field(default=20,ge=5,le=100)
    atr_multiplier: float = Field(default=2,ge=1,le=5)
    reward_risk: float = Field(default=2,ge=1,le=5)

@app.post("/scan")
def scan_endpoint(body: ScanRequest, authorization: str = Header(default="")):
    key=os.environ.get("MT5_BRIDGE_KEY","")
    if len(key)<32 or not secrets.compare_digest(authorization,"Bearer "+key):
        raise HTTPException(401,"Unauthorized")
    if body.fast>=body.slow or body.strategy not in ("ensemble","ma","bollinger","rsi","macd","trend","reversion","breakout") or any(not s or len(s)>128 for s in body.symbols):
        raise HTTPException(400,"Invalid scanner configuration")
    with lock:
        try:
            if not mt5.initialize(timeout=15000):
                raise HTTPException(503,"Terminal unavailable")
            a,t=mt5.account_info(),mt5.terminal_info()
            if not a or not t or not t.connected or a.login!=body.login or a.server!=body.server or a.trade_mode!=mt5.ACCOUNT_TRADE_MODE_DEMO:
                raise HTTPException(403,"Verified demo account unavailable")
            instruments=mt5.symbols_get()
            if instruments is None or not set(body.symbols).issubset({s.name for s in instruments if s.visible}):
                raise HTTPException(400,"Select Market Watch symbols")
            return {"source":"MT5","signals":scan_markets(mt5,list(dict.fromkeys(body.symbols)),body.strategy,os.environ.get("MT5_ORDER_DB","mt5-orders.sqlite3"),{k:getattr(body,k) for k in ("fast","slow","period","atr_multiplier","reward_risk")})}
        finally:
            mt5.shutdown()
