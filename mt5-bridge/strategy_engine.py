"""Deterministic closed-candle strategy evaluation; never submits orders."""
import math
from statistics import mean, pstdev

def ema(values, n):
    v=mean(values[:n])
    for x in values[n:]:
        v += 2/(n+1)*(x-v)
    return v

def evaluate(candles, strategy="ensemble", fast=10, slow=30, period=20, atr_multiplier=2.0, reward_risk=2.0):
    if not (2<=fast<slow<=100 and 5<=period<=100 and 1<=atr_multiplier<=5 and 1<=reward_risk<=5):
        raise ValueError("Invalid strategy configuration")
    if strategy not in ("ensemble","ma","bollinger","rsi","macd","trend","reversion","breakout"):
        raise ValueError("Unknown strategy")
    def hold(reason):
        return {"side":"HOLD","strategy":strategy,"reason":reason,"score":0}
    if len(candles)<max(slow+2,period+2,40):
        return hold("Insufficient closed candles")
    for i,c in enumerate(candles):
        try:
            o,h,l,p,t=(float(c[k]) for k in ("open","high","low","close","time"))
            if not all(isinstance(c[k],(int,float)) and not isinstance(c[k],bool) for k in ("open","high","low","close","time")):
                return hold("Invalid candle series")
        except (KeyError,TypeError,ValueError,OverflowError):
            return hold("Invalid candle series")
        if not all(math.isfinite(x) for x in (o,h,l,p,t)) or l<=0 or h<max(o,p) or l>min(o,p) or (i and t<=candles[i-1]["time"]):
            return hold("Invalid candle series")
    x=[c["close"] for c in candles]
    p=x[-1]
    atr=mean([max(c["high"]-c["low"],abs(c["high"]-prev["close"]),abs(c["low"]-prev["close"])) for prev,c in zip(candles[-15:-1],candles[-14:])])
    if atr<=0: return hold("No measurable volatility")
    f,s=mean(x[-fast:]),mean(x[-slow:])
    fp,sp=mean(x[-fast-1:-1]),mean(x[-slow-1:-1])
    mid,sd=mean(x[-period:]),pstdev(x[-period:])
    changes=[b-a for a,b in zip(x[-15:-1],x[-14:])]
    gain,loss=mean([max(0,v) for v in changes]),mean([max(0,-v) for v in changes])
    rsi=100*gain/(gain+loss) if gain+loss else 50
    macd=[ema(x[:i],12)-ema(x[:i],26) for i in range(len(x)-9,len(x)+1)]
    hist=macd[-1]-ema(macd,9)
    hi=max(c["high"] for c in candles[-period-1:-1])
    lo=min(c["low"] for c in candles[-period-1:-1])
    votes={
        "ma":1 if fp<=sp and f>s else -1 if fp>=sp and f<s else 0,
        "bollinger":1 if sd and mid+sd<p<=mid+2*sd else -1 if sd and mid-2*sd<=p<mid-sd else 0,
        "rsi":1 if rsi<30 else -1 if rsi>70 else 0,
        "macd":1 if hist>0 and macd[-1]>0 else -1 if hist<0 and macd[-1]<0 else 0,
        "trend":1 if p>f>s else -1 if p<f<s else 0,
        "reversion":1 if sd and p<mid-2*sd else -1 if sd and p>mid+2*sd else 0,
        "breakout":1 if p>hi else -1 if p<lo else 0,
    }
    regime="trend" if abs(f-s)>atr else "range"
    eligible=("ma","bollinger","macd","trend","breakout") if regime=="trend" else ("rsi","reversion")
    score=sum(votes[k] for k in eligible) if strategy=="ensemble" else votes[strategy]
    threshold=2 if strategy=="ensemble" else 1
    if abs(score)<threshold: return {**hold("Insufficient directional agreement"),"votes":votes,"regime":regime}
    direction=1 if score>0 else -1
    distance=atr*atr_multiplier
    sl,tp=p-direction*distance,p+direction*distance*reward_risk
    if min(sl,tp)<=0: return hold("Invalid protective prices")
    return {"side":"BUY" if direction>0 else "SELL","strategy":strategy,"score":score,"votes":votes,"regime":regime,"reason":"Directional indicator agreement","referencePrice":p,"sl":sl,"tp":tp,"atr":atr,"rsi":rsi,"candleTime":candles[-1]["time"]}
