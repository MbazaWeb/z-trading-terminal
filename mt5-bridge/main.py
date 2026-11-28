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
def broker(*, allow_real=False):
    with LOCK:
        if not mt5.initialize():
            raise HTTPException(503, "MT5 unavailable")

        try:
            account = mt5.account_info()

            if account is None:
                raise HTTPException(503, "No MT5 account")

            if account.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO:
                if not allow_real or account.trade_mode != mt5.ACCOUNT_TRADE_MODE_REAL:
                    raise HTTPException(403, "Account mode not authorized")

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

@app.post("/order-check", dependencies=[Depends(authenticate)])
def order_check(order: PreflightRequest):
    # Read-only validation; never sends an order.
    with LOCK:
        estimate = preflight(order)
        with broker() as account:
            info = mt5.symbol_info(order.symbol)
            tick = mt5.symbol_info_tick(order.symbol)
            if info is None or tick is None or not account.trade_allowed or not account.trade_expert:
                raise HTTPException(503, "Trading unavailable")
            if not 0 <= time.time() - tick.time <= 10:
                raise HTTPException(503, "Stale quote")
            buy = order.side == "buy"
            entry = tick.ask if buy else tick.bid
            if not math.isfinite(entry) or entry <= 0 or entry != estimate["entry"]:
                raise HTTPException(409, "Quote changed; repeat preflight")
            kind = mt5.ORDER_TYPE_BUY if buy else mt5.ORDER_TYPE_SELL
            request = {"action": mt5.TRADE_ACTION_DEAL, "symbol": order.symbol,
                       "volume": order.volume, "type": kind, "price": entry,
                       "sl": order.stopLoss, "tp": order.takeProfit,
                       "type_time": mt5.ORDER_TIME_GTC}
            if info.filling_mode & 1:
                request["type_filling"] = mt5.ORDER_FILLING_FOK
            elif info.filling_mode & 2:
                request["type_filling"] = mt5.ORDER_FILLING_IOC
            else:
                raise HTTPException(422, "Unsupported filling policy")
            result = mt5.order_check(request)
            if result is None or result.retcode != 0:
                raise HTTPException(422, "Broker order check rejected")
            return {**estimate, "brokerCheckPassed": True, "executable": False}

from request_ledger import reserve_request, record_outcome
from uuid import UUID
import hashlib
import json

class SubmissionRequest(PreflightRequest):
    requestId: UUID

def submit_demo_order(order: SubmissionRequest):
    # Internal transport only. Do not expose as an HTTP endpoint until
    # aggregate risk, emergency stop and reconciliation are integrated.
    if os.getenv("REAL_TRADING_ENABLED") != "false" or os.getenv("MT5_DEMO_EXECUTION") != "true":
        raise HTTPException(403, "Demo execution disabled")
    ledger_setting = os.getenv("MT5_REQUEST_LEDGER_PATH", "")
    ledger = Path(ledger_setting)
    if not ledger_setting or not ledger.is_absolute() or not ledger.parent.is_dir():
        raise HTTPException(503, "Durable ledger not configured")
    with LOCK:
        checked = order_check(order)
        with broker() as account:
            tick = mt5.symbol_info_tick(order.symbol)
            info = mt5.symbol_info(order.symbol)
            if tick is None or info is None or not account.trade_allowed or not account.trade_expert:
                raise HTTPException(503, "Broker unavailable")
            buy = order.side == "buy"
            entry = tick.ask if buy else tick.bid
            if entry != checked["entry"] or not 0 <= time.time()-tick.time <= 5:
                raise HTTPException(409, "Quote changed")
            if mt5.positions_get() is None or mt5.orders_get() is None:
                raise HTTPException(503, "Exposure unavailable")
            # Pilot transport permits only an empty account.
            if mt5.positions_get() or mt5.orders_get():
                raise HTTPException(409, "Existing exposure requires reconciliation")
            request = {"action": mt5.TRADE_ACTION_DEAL, "symbol": order.symbol,
                       "volume": order.volume, "type": mt5.ORDER_TYPE_BUY if buy else mt5.ORDER_TYPE_SELL,
                       "price": entry, "sl": order.stopLoss, "tp": order.takeProfit,
                       "type_time": mt5.ORDER_TIME_GTC, "comment": str(order.requestId).replace("-", "")[:24]}
            if not info.filling_mode & 1:
                raise HTTPException(422, "FOK filling required")
            request["type_filling"] = mt5.ORDER_FILLING_FOK
            check = mt5.order_check(request)
            if check is None or check.retcode != 0:
                raise HTTPException(422, "Broker rejected order check")
            # Internal transport: callers must enforce controller authorization.
            daily = float(os.getenv("AI_DAILY_LOSS_LIMIT_ACCOUNT_CURRENCY", "0"))
            costs = float(os.getenv("AI_ESTIMATED_COSTS_PER_LOT", "0")) * order.volume
            now = datetime.now(timezone.utc)
            deals = mt5.history_deals_get(now.replace(hour=0, minute=0, second=0, microsecond=0), now)
            if deals is None or not math.isfinite(daily) or daily <= 0 or not math.isfinite(costs) or costs <= 0:
                raise HTTPException(503, "Daily risk evidence unavailable")
            pnl = sum(d.profit + d.commission + d.swap + d.fee for d in deals
                      if d.type in (mt5.DEAL_TYPE_BUY, mt5.DEAL_TYPE_SELL))
            if any(d.type not in (mt5.DEAL_TYPE_BUY, mt5.DEAL_TYPE_SELL, mt5.DEAL_TYPE_BALANCE, mt5.DEAL_TYPE_CREDIT) for d in deals):
                raise HTTPException(503, "Unclassified account transaction")
            if not math.isfinite(pnl) or checked["estimatedStopLoss"] + costs > min(daily + min(0, pnl), account.equity * 0.02):
                raise HTTPException(422, "Daily risk limit exceeded")
            fingerprint = hashlib.sha256(json.dumps(request, sort_keys=True).encode()).hexdigest()
            reserve_request(ledger, str(order.requestId), f"{account.server}:{account.login}", fingerprint)
            broker_id = None
            try:
                result = mt5.order_send(request)
                if (result is not None and result.retcode == mt5.TRADE_RETCODE_DONE
                    and result.order > 0 and result.deal > 0
                    and math.isclose(result.volume, order.volume, rel_tol=0, abs_tol=1e-8)):
                    confirmed = mt5.history_deals_get(ticket=result.order)
                    if confirmed is not None:
                        matches = [d for d in confirmed if d.ticket == result.deal
                                   and d.order == result.order and d.symbol == order.symbol
                                   and d.type == request["type"] and d.entry == mt5.DEAL_ENTRY_IN
                                   and math.isclose(d.volume, order.volume, rel_tol=0, abs_tol=1e-8)]
                        if len(matches) == 1:
                            broker_id = str(result.order)
            finally:
                record_outcome(ledger, str(order.requestId), broker_id)
            return {"status": "confirmed", "brokerOrderId": broker_id} if broker_id else {"status": "unknown"}

@app.get("/risk-specs", dependencies=[Depends(authenticate)])
def risk_specs(symbol: str):
    with broker() as account:
        if not mt5.symbol_select(symbol, True):
            raise HTTPException(404, "Symbol unavailable")
        info = mt5.symbol_info(symbol)
        if info is None or info.trade_mode != mt5.SYMBOL_TRADE_MODE_FULL:
            raise HTTPException(503, "Symbol unavailable")
        values = {"tickSize": info.trade_tick_size,
                  "lossTickValue": info.trade_tick_value_loss,
                  "minVolume": info.volume_min, "maxVolume": info.volume_max,
                  "volumeStep": info.volume_step, "point": info.point,
                  "contractSize": info.trade_contract_size}
        if not all(math.isfinite(v) and v > 0 for v in values.values()):
            raise HTTPException(503, "Invalid broker specifications")
        if info.volume_max < info.volume_min or info.trade_stops_level < 0:
            raise HTTPException(503, "Invalid broker constraints")
        return {**values, "symbol": symbol, "currency": account.currency,
                "login": str(account.login), "server": account.server,
                "minStopDistance": info.trade_stops_level * info.point,
                "observedAt": int(time.time() * 1000), "accountType": "demo"}

@app.get("/account-risk", dependencies=[Depends(authenticate)])
def account_risk():
    from datetime import datetime, timezone
    with broker() as account:
        now = datetime.now(timezone.utc)
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        deals = mt5.history_deals_get(start, now)
        positions = mt5.positions_get()
        orders = mt5.orders_get()
        if deals is None or positions is None or orders is None:
            raise HTTPException(503, "Account risk history unavailable")
        if orders:
            raise HTTPException(409, "Pending orders require risk reconciliation")
        pnl = 0.0
        for deal in deals:
            if deal.type in (mt5.DEAL_TYPE_BUY, mt5.DEAL_TYPE_SELL):
                pnl += deal.profit + deal.commission + deal.swap + deal.fee
            elif deal.type not in (mt5.DEAL_TYPE_BALANCE, mt5.DEAL_TYPE_CREDIT):
                raise HTTPException(503, "Unclassified account transaction")
        exposure = 0.0
        for p in positions:
            tick = mt5.symbol_info_tick(p.symbol)
            if tick is None or not 0 <= time.time()-tick.time <= 10 or not math.isfinite(p.sl) or p.sl <= 0:
                raise HTTPException(503, "Unprotected position or stale quote")
            if p.type not in (mt5.POSITION_TYPE_BUY, mt5.POSITION_TYPE_SELL):
                raise HTTPException(503, "Unsupported position")
            buy = p.type == mt5.POSITION_TYPE_BUY
            price = tick.bid if buy else tick.ask
            if not math.isfinite(price) or price <= 0 or (buy and p.sl >= price) or (not buy and p.sl <= price):
                raise HTTPException(503, "Invalid position protection")
            loss = mt5.order_calc_profit(mt5.ORDER_TYPE_BUY if buy else mt5.ORDER_TYPE_SELL,
                                         p.symbol, p.volume, price, p.sl)
            if loss is None or not math.isfinite(loss) or loss >= 0:
                raise HTTPException(503, "Position risk unavailable")
            exposure += -loss
        if not all(math.isfinite(v) for v in (pnl, exposure, account.equity, account.margin_free)):
            raise HTTPException(503, "Invalid account risk")
        return {"login": str(account.login), "server": account.server,
                "currency": account.currency, "accountType": "demo",
                "equity": account.equity, "freeMargin": account.margin_free,
                "dailyRealizedPnl": pnl, "openRisk": exposure,
                "openPositions": len(positions), "pendingOrders": len(orders),
                "dayStart": start.isoformat(), "observedAt": int(now.timestamp()*1000),
                "executable": False}


from reconciliation import match_deals
from datetime import datetime, timezone, timedelta

@app.get("/recovery-candidate", dependencies=[Depends(authenticate)])
def recovery_candidate(requestId: UUID, symbol: str, side: str):
    if side not in ("buy", "sell"):
        raise HTTPException(422, "Invalid side")
    # Diagnostic only: never changes the ledger or authorizes submission.
    with broker() as account:
        now = datetime.now(timezone.utc)
        deals = mt5.history_deals_get(now - timedelta(days=7), now)
        result = match_deals(str(requestId), deals, expected_symbol=symbol,
                             expected_type=mt5.DEAL_TYPE_BUY if side == "buy" else mt5.DEAL_TYPE_SELL)
        return {**result, "login": str(account.login), "server": account.server,
                "accountType": "demo", "historyWindowDays": 7, "executable": False}


@app.get("/verified-account", dependencies=[Depends(authenticate)])
def verified_account():
    # Read-only identity discovery. Existing execution routes remain demo-only.
    with broker(allow_real=True) as account:
        return {"login": str(account.login), "server": account.server,
                "accountType": "real" if account.trade_mode == mt5.ACCOUNT_TRADE_MODE_REAL else "demo",
                "currency": account.currency, "balance": account.balance,
                "equity": account.equity, "freeMargin": account.margin_free,
                "tradeAllowed": bool(account.trade_allowed), "executable": False}
