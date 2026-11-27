import math
from datetime import datetime, timezone

def check_portfolio(mt5, account, symbol, estimated_loss):
    if not all(math.isfinite(v) for v in (estimated_loss,account.equity,account.balance,account.profit)) or estimated_loss<=0 or account.equity<=0 or account.balance<=0:
        return "Invalid portfolio risk inputs"
    positions = mt5.positions_get()
    orders = mt5.orders_get()
    now = datetime.now(timezone.utc)
    deals = mt5.history_deals_get(now.replace(hour=0,minute=0,second=0,microsecond=0), now)
    if positions is None or orders is None or deals is None:
        return "Portfolio data unavailable"
    if len(positions) >= 3 or orders:
        return "Position limit or pending orders"
    if any(p.symbol == symbol for p in positions):
        return "Existing position on symbol"
    net = sum(d.profit+d.commission+d.swap+d.fee for d in deals if d.type in (mt5.DEAL_TYPE_BUY,mt5.DEAL_TYPE_SELL))
    if not math.isfinite(net):
        return "Invalid broker profit history"
    if net + min(0,account.profit) <= -min(10,account.balance*0.02):
        return "Daily loss limit reached"
    exposure = estimated_loss
    for p in positions:
        if p.sl <= 0:
            return "Existing position has no stop loss"
        typ = mt5.ORDER_TYPE_BUY if p.type == mt5.POSITION_TYPE_BUY else mt5.ORDER_TYPE_SELL
        loss = mt5.order_calc_profit(typ,p.symbol,p.volume,p.price_current,p.sl)
        if loss is None or not math.isfinite(loss):
            return "Existing position risk unavailable"
        exposure += max(0,-loss)
    if not math.isfinite(exposure) or exposure > account.equity*0.02:
        return "Aggregate estimated stop risk exceeds 2% equity"
    return None
