"""Position monitoring and conservative trailing-stop recommendations."""
import math
import time

def monitor(mt5, positions):
    rows=[]
    for p in positions:
        row={"ticket":str(p.ticket),"symbol":p.symbol,"profit":p.profit,"swap":p.swap,"volume":p.volume,"sl":p.sl,"tp":p.tp,"managed":p.magic==260427,"action":"HOLD","reason":"No protective adjustment required"}
        rows.append(row)
        if not row["managed"]:
            row["reason"]="External position; monitor only"
            continue
        if p.sl<=0 or p.tp<=0:
            row.update(action="ALERT",reason="Missing protective level; manual review required")
            continue
        q,s=mt5.symbol_info_tick(p.symbol),mt5.symbol_info(p.symbol)
        if not q or not s or not 0<=time.time()-q.time<=30 or not 0<q.bid<=q.ask or s.trade_tick_size<=0:
            row.update(action="ALERT",reason="Fresh quote unavailable")
            continue
        rates=mt5.copy_rates_from_pos(p.symbol,mt5.TIMEFRAME_M15,1,15)
        if rates is None or len(rates)<15 or not 900<=time.time()-float(rates[-1]["time"])<=1860:
            row.update(action="ALERT",reason="Closed candle history unavailable")
            continue
        atr=sum(max(float(c["high"]-c["low"]),abs(float(c["high"]-prev["close"])),abs(float(c["low"]-prev["close"]))) for prev,c in zip(rates[:-1],rates[1:]))/14
        if not math.isfinite(atr) or atr<=0: continue
        buy=p.type==mt5.POSITION_TYPE_BUY
        price=q.bid if buy else q.ask
        direction=1 if buy else -1
        if direction*(price-p.price_open)<2*atr: continue
        gap=max(2*atr,(max(s.trade_stops_level,s.trade_freeze_level,1)+1)*s.point)
        tick=s.trade_tick_size
        raw=price-direction*gap
        sl=round((math.floor(raw/tick) if buy else math.ceil(raw/tick))*tick,s.digits)
        if sl>0 and direction*(sl-p.sl)>=tick and direction*(sl-p.price_open)>=0 and direction*(p.tp-price)>=gap:
            row.update(action="TRAIL",recommendedSl=sl,reason="ATR trailing stop tightens protection")
    return rows
