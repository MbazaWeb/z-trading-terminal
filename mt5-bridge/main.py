import os
import secrets
import threading
from contextlib import contextmanager
from pathlib import Path

import MetaTrader5 as mt5
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Depends

load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")

app = FastAPI(
    title="Z Trading MT5 Bridge",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None
)

KEY = os.getenv("MT5_BRIDGE_KEY", "").strip()
LOCK = threading.RLock()

def authenticate(
    x_bridge_key: str = Header(default="")
):
    if not KEY or len(KEY) < 32:
        raise HTTPException(503, "Bridge key not configured")

    if not secrets.compare_digest(
        x_bridge_key.encode(), KEY.encode()
    ):
        raise HTTPException(401, "Unauthorized")

@contextmanager
def broker():
    with LOCK:
        if not mt5.initialize():
            raise HTTPException(503, "MT5 unavailable")

        try:
            account = mt5.account_info()

            if account is None:
                raise HTTPException(503, "No MT5 account")

            if account.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO:
                raise HTTPException(403, "Demo accounts only")

            expected_login = os.getenv("MT5_LOGIN", "").strip()
            expected_server = os.getenv("MT5_SERVER", "").strip()

            if not expected_login or not expected_server:
                raise HTTPException(503, "Account binding missing")

            if str(account.login) != expected_login:
                raise HTTPException(403, "Account mismatch")

            if account.server != expected_server:
                raise HTTPException(403, "Server mismatch")

            yield account
        finally:
            mt5.shutdown()

@app.get("/health", dependencies=[Depends(authenticate)])
def health():
    with broker() as account:
        return {
            "ok": True,
            "connected": True,
            "provider": "mt5",
            "mode": "demo",
            "server": account.server,
            "tradeAllowed": account.trade_allowed,
            "expertAllowed": account.trade_expert
        }

@app.get("/account", dependencies=[Depends(authenticate)])
def account_info():
    with broker() as account:
        return {
            "login": str(account.login),
            "server": account.server,
            "currency": account.currency,
            "balance": account.balance,
            "equity": account.equity,
            "margin": account.margin,
            "freeMargin": account.margin_free,
            "leverage": account.leverage,
            "tradeAllowed": account.trade_allowed,
            "accountType": "demo"
        }

@app.get("/symbols", dependencies=[Depends(authenticate)])
def symbols():
    with broker():
        items = mt5.symbols_get()

        if items is None:
            raise HTTPException(503, "Symbol lookup failed")

        return {
            "symbols": [
                {
                    "symbol": s.name,
                    "description": s.description,
                    "minVolume": s.volume_min,
                    "maxVolume": s.volume_max,
                    "volumeStep": s.volume_step,
                    "contractSize": s.trade_contract_size,
                    "tickSize": s.trade_tick_size,
                    "tradeMode": s.trade_mode
                }
                for s in items
                if s.trade_mode != mt5.SYMBOL_TRADE_MODE_DISABLED
            ]
        }

@app.get("/tick", dependencies=[Depends(authenticate)])
def tick(symbol: str):
    with broker():
        if not mt5.symbol_select(symbol, True):
            raise HTTPException(404, "Symbol unavailable")

        data = mt5.symbol_info_tick(symbol)

        if data is None or data.bid <= 0 or data.ask <= 0 or data.time <= 0:
            raise HTTPException(503, "Price unavailable")

        return {
            "symbol": symbol,
            "bid": data.bid,
            "ask": data.ask,
            "spread": data.ask - data.bid,
            "time": data.time
        }

@app.get("/positions", dependencies=[Depends(authenticate)])
def positions():
    with broker():
        items = mt5.positions_get()

        if items is None:
            raise HTTPException(503, "Position lookup failed")

        return {
            "positions": [
                {
                    "id": str(p.ticket),
                    "symbol": p.symbol,
                    "side": "buy" if p.type == 0 else "sell",
                    "volume": p.volume,
                    "openPrice": p.price_open,
                    "currentPrice": p.price_current,
                    "profit": p.profit,
                    "stopLoss": p.sl,
                    "takeProfit": p.tp,
                    "openedAt": p.time * 1000
                }
                for p in items
            ]
        }


@app.get("/market", dependencies=[Depends(authenticate)])
def market(symbol: str):
    import time
    import math
    with broker():
        if not mt5.symbol_select(symbol, True):
            raise HTTPException(404, "Symbol unavailable")
        info = mt5.symbol_info(symbol)
        tick = mt5.symbol_info_tick(symbol)
        now = time.time()
        if info is None or tick is None or info.trade_mode != mt5.SYMBOL_TRADE_MODE_FULL:
            raise HTTPException(503, "Market unavailable")
        if not all(math.isfinite(x) for x in (tick.bid, tick.ask)) or not 0 < tick.bid <= tick.ask or not 0 <= now - tick.time <= 60:
            raise HTTPException(503, "Stale or invalid quote")
        rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M1, 1, 150)
        if rates is None or len(rates) < 50:
            raise HTTPException(503, "Insufficient closed candles")
        candles = [{"time": int(r["time"]) * 1000, "open": float(r["open"]),
                    "high": float(r["high"]), "low": float(r["low"]),
                    "close": float(r["close"]), "volume": int(r["tick_volume"])} for r in rates]
        if not 0 <= now - candles[-1]["time"] / 1000 - 60 <= 120:
            raise HTTPException(503, "Stale candle history")
        return {"symbol": symbol, "bid": tick.bid, "ask": tick.ask,
                "observedAt": tick.time * 1000, "candles": candles,
                "volumeType": "tick_count", "provider": "mt5", "accountType": "demo"}

from pydantic import BaseModel, Field
from typing import Literal
import math
import time

class PreflightRequest(BaseModel):
    symbol: str = Field(pattern=r"^[A-Za-z0-9._-]{1,32}$")
    side: Literal["buy", "sell"]
    volume: float = Field(gt=0, allow_inf_nan=False)
    stopLoss: float = Field(gt=0, allow_inf_nan=False)
    takeProfit: float = Field(gt=0, allow_inf_nan=False)

@app.post("/preflight", dependencies=[Depends(authenticate)])
def preflight(order: PreflightRequest):
    with broker() as account:
        if not account.trade_allowed or not account.trade_expert:
            raise HTTPException(403, "Trading unavailable")
        if not mt5.symbol_select(order.symbol, True):
            raise HTTPException(404, "Symbol unavailable")
        info = mt5.symbol_info(order.symbol)
        tick = mt5.symbol_info_tick(order.symbol)
        if info is None or tick is None or info.trade_mode != mt5.SYMBOL_TRADE_MODE_FULL:
            raise HTTPException(503, "Market unavailable")
        if not all(math.isfinite(x) for x in (tick.bid, tick.ask)) or not 0 < tick.bid <= tick.ask or not 0 <= time.time() - tick.time <= 10:
            raise HTTPException(503, "Invalid or stale quote")
        if info.volume_step <= 0 or not info.volume_min <= order.volume <= info.volume_max:
            raise HTTPException(422, "Invalid volume")
        steps = (order.volume - info.volume_min) / info.volume_step
        if abs(steps - round(steps)) > 1e-7:
            raise HTTPException(422, "Invalid volume step")
        buy = order.side == "buy"
        kind = mt5.ORDER_TYPE_BUY if buy else mt5.ORDER_TYPE_SELL
        entry = tick.ask if buy else tick.bid
        distance = tick.bid - order.stopLoss if buy else order.stopLoss - tick.ask
        reward = order.takeProfit - entry if buy else entry - order.takeProfit
        risk = entry - order.stopLoss if buy else order.stopLoss - entry
        if distance <= 0 or distance < info.trade_stops_level * info.point or reward < 1.5 * risk:
            raise HTTPException(422, "Invalid protective levels")
        margin = mt5.order_calc_margin(kind, order.symbol, order.volume, entry)
        pnl = mt5.order_calc_profit(kind, order.symbol, order.volume, entry, order.stopLoss)
        if margin is None or pnl is None or not all(math.isfinite(x) for x in (margin, pnl, account.equity, account.margin_free)) or margin <= 0 or pnl >= 0:
            raise HTTPException(503, "Broker calculation unavailable")
        if margin > account.margin_free * 0.8 or -pnl > account.equity * 0.02:
            raise HTTPException(422, "Broker risk limit exceeded")
        return {"symbol": order.symbol, "side": order.side, "volume": order.volume,
                "entry": entry, "margin": margin, "estimatedStopLoss": -pnl,
                "currency": account.currency, "observedAt": tick.time * 1000,
                "accountType": "demo", "executable": False}
