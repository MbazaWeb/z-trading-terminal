import os
import secrets
import threading
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
