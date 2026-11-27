import os
from datetime import datetime, timezone
from pathlib import Path

def check_portfolio(mt5, account, proposed_loss):
    if Path(os.environ.get("MT5_STOP_FILE", "STOP_TRADING")).exists():
        return "Emergency stop active"
    positions = mt5.positions_get()
    orders = mt5.orders_get()
    now = datetime.now(timezone.utc)
    deals = mt5.history_deals_get(now.replace(hour=0, minute=0, second=0, microsecond=0), now)
    if positions is None or orders is None or deals is None:
        return "Portfolio verification unavailable"
    if len(positions) >= 3 or len(orders):
        return "Position limit reached or pending orders exist"
    realized = sum(d.profit + d.commission + d.swap + d.fee for d in deals if d.type in (mt5.DEAL_TYPE_BUY, mt5.DEAL_TYPE_SELL))
    floating = sum(p.profit + p.swap for p in positions)
    if realized + min(0, floating) <= -account.equity * 0.02:
        return "Daily loss limit reached"
    exposure = proposed_loss
    for p in positions:
        if p.sl <= 0:
            return "Existing position has no stop loss"
        loss = mt5.order_calc_profit(p.type, p.symbol, p.volume, p.price_current, p.sl)
        if loss is None:
            return "Existing exposure unavailable"
        exposure += max(0, -loss)
    if exposure > account.equity * 0.02:
        return "Aggregate estimated stop risk exceeded"
    return None
