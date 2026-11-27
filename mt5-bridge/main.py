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
                                   "profit": p.profit, "swap": p.swap} for p in positions],
                    "deals": [{"ticket": str(d.ticket), "symbol": d.symbol, "time": d.time,
                               "entry": d.entry, "type": d.type, "volume": d.volume,
                               "profit": d.profit, "commission": d.commission, "swap": d.swap, "fee": d.fee}
                              for d in deals if d.type in (mt5.DEAL_TYPE_BUY, mt5.DEAL_TYPE_SELL)]}
        finally:
            mt5.shutdown()

# Demo execution is opt-in and restricted to a dedicated account.
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
                try:
                    db.execute("INSERT INTO requests VALUES (?,?)",(str(body.request_id),"pending"))
                    db.commit()
                except sqlite3.IntegrityError:
                    raise HTTPException(409,"Duplicate request; reconcile broker history")
                result=mt5.order_send(req)
                status="confirmed" if result is not None and result.retcode==mt5.TRADE_RETCODE_DONE and result.deal else "uncertain"
                db.execute("UPDATE requests SET status=? WHERE id=?",(status,str(body.request_id)))
                db.commit()
                return {"status":status,"requestId":str(body.request_id),"retcode":result.retcode if result else None,"deal":str(result.deal) if result else None,"order":str(result.order) if result else None}
        finally:
            mt5.shutdown()
