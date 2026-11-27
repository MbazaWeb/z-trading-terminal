"""Read-only agent orchestration. Final execution must revalidate all risk."""
import math
import time
from risk import check_portfolio

def assess(mt5, account, signals):
    output=[]
    for s in signals:
        stages=[]
        def stage(agent,status,reason):
            stages.append({"agent":agent,"status":status,"reason":reason})
        symbol=s["symbol"]
        frames=s.get("frames")
        stage("Market Data","pass" if frames else "reject","Closed candles available" if frames else s["reason"])
        stage("Technical Analysis","pass" if frames else "skip","Indicators evaluated" if frames else "No validated candles")
        stage("Market Regime","pass" if s.get("regime") else "skip",s.get("regime","Regime unavailable"))
        candidate=s["side"] in ("BUY","SELL")
        stage("Strategy","pass" if candidate else "reject",s["reason"])
        reason="No directional signal"
        if candidate:
            q=mt5.symbol_info_tick(symbol)
            info=mt5.symbol_info(symbol)
            if not q or not info or not (0<=time.time()-q.time<=30) or not (0<q.bid<=q.ask):
                reason="Fresh quote or symbol details unavailable"
            elif not (0<info.volume_min<=0.01):
                reason="Minimum lot exceeds demo cap"
            elif not math.isfinite(account.equity) or account.equity<=0:
                reason="Invalid account equity"
            else:
                buy=s["side"]=="BUY"
                typ=mt5.ORDER_TYPE_BUY if buy else mt5.ORDER_TYPE_SELL
                price=q.ask if buy else q.bid
                sl,tp=s.get("sl",0),s.get("tp",0)
                if not (0<sl<price<tp if buy else 0<tp<price<sl):
                    reason="Protective levels invalid at current quote"
                else:
                    loss=mt5.order_calc_profit(typ,symbol,info.volume_min,price,sl)
                    if loss is None or not math.isfinite(loss) or loss>=0 or -loss>account.equity*.01:
                        reason="Estimated stop risk unavailable or exceeds 1% equity"
                    else:
                        reason=check_portfolio(mt5,account,symbol,-loss)
        stage("Risk Management","pass" if reason is None else "reject" if candidate else "skip",reason or "Preliminary portfolio risk passed")
        stage("Decision","pass" if reason is None else "reject",reason or "Candidate for execution revalidation")
        stage("Execution","skip","Analysis only; no order submitted")
        output.append({"symbol":symbol,"signal":s,"decision":"CANDIDATE" if reason is None else "HOLD","stages":stages})
    return output
