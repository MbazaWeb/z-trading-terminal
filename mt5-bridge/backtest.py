"""Historical bar replay in price units, not account currency."""
from strategy_engine import evaluate
import math

def replay(candles,strategy,start,end,cost,config):
    trades=[]
    equity=peak=drawdown=0.0
    position=None
    for i in range(start,end):
        c=candles[i]
        if position is None:
            signal=evaluate(candles[max(0,i-150):i],strategy,**config)
            if signal["side"]!="HOLD":
                direction=1 if signal["side"]=="BUY" else -1
                entry=c["open"]
                distance=abs(signal["referencePrice"]-signal["sl"])
                target=abs(signal["tp"]-signal["referencePrice"])
                position=(direction,entry,entry-direction*distance,entry+direction*target,i)
        if position is None: continue
        d,entry,sl,tp,opened=position
        stop=c["low"]<=sl if d==1 else c["high"]>=sl
        take=c["high"]>=tp if d==1 else c["low"]<=tp
        if stop:
            exit_price=min(sl,c["open"]) if d==1 else max(sl,c["open"])
            reason="stop"
        elif take:
            exit_price=tp
            reason="target"
        elif i==end-1:
            exit_price=c["close"]
            reason="sample_end"
        else: continue
        pnl=d*(exit_price-entry)-cost
        equity+=pnl
        peak=max(peak,equity)
        drawdown=max(drawdown,peak-equity)
        trades.append({"entryTime":candles[opened]["time"],"exitTime":c["time"],"side":"BUY" if d==1 else "SELL","entry":entry,"exit":exit_price,"net":pnl,"reason":reason})
        position=None
    wins=sum(t["net"]>0 for t in trades)
    gross_profit=sum(max(0,t["net"]) for t in trades)
    gross_loss=sum(max(0,-t["net"]) for t in trades)
    return {"trades":len(trades),"wins":wins,"losses":sum(t["net"]<0 for t in trades),"winRate":wins/len(trades)*100 if trades else None,"net":equity,"maxClosedDrawdown":drawdown,"profitFactor":gross_profit/gross_loss if gross_loss else None,"grossProfit":gross_profit,"grossLoss":gross_loss,"details":trades}

def backtest(candles,strategies,cost,config):
    if len(candles)<400 or not math.isfinite(cost) or cost<0:
        raise ValueError("At least 400 candles and nonnegative cost required")
    for i,c in enumerate(candles):
        if not all(math.isfinite(c[k]) for k in ("time","open","high","low","close")) or c["low"]<=0 or c["high"]<max(c["open"],c["close"]) or c["low"]>min(c["open"],c["close"]) or (i and c["time"]<=candles[i-1]["time"]):
            raise ValueError("Invalid historical candles")
    split=int(len(candles)*.7)
    return {"unit":"price units per unit of asset","costPerRoundTrip":cost,"splitTime":candles[split]["time"],"results":[{"strategy":s,"inSample":replay(candles,s,150,split,cost,config),"outOfSample":replay(candles,s,split,len(candles),cost,config)} for s in strategies]}
