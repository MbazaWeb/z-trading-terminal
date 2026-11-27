import json
import time
import math
import sqlite3
from strategy_engine import evaluate

def scan(mt5, symbols, strategy, db_path, config=None):
    config=config or {}
    results=[]
    for symbol in symbols:
        try:
            q=mt5.symbol_info_tick(symbol)
            if not q or not (0<=time.time()-q.time<=60) or not (0<q.bid<=q.ask):
                results.append({"symbol":symbol,"side":"HOLD","reason":"Fresh quote unavailable"})
                continue
            frames={}
            for label,frame,seconds in (("15m",mt5.TIMEFRAME_M15,900),("1H",mt5.TIMEFRAME_H1,3600)):
                rates=mt5.copy_rates_from_pos(symbol,frame,1,150)
                if rates is None or len(rates)<40:
                    raise ValueError("Insufficient closed candles")
                candles=[{k:float(r[k]) for k in ("time","open","high","low","close")} for r in rates]
                if not (seconds<=time.time()-candles[-1]["time"]<=seconds*2+60):
                    raise ValueError("Closed candle history stale")
                frames[label]=evaluate(candles,strategy,**config)
            primary=frames["15m"]
            signal={**primary,"symbol":symbol,"frames":frames,"source":"MT5","config":config,"scannedAt":int(time.time()*1000)}
            if primary["side"]!="HOLD" and primary["side"]!=frames["1H"]["side"]:
                signal.update(side="HOLD",reason="Higher timeframe does not confirm")
            results.append(signal)
        except (ValueError,TypeError,KeyError,ArithmeticError):
            results.append({"symbol":symbol,"side":"HOLD","reason":"Invalid or incomplete market data"})
    with sqlite3.connect(db_path) as db:
        db.execute("CREATE TABLE IF NOT EXISTS signals (id TEXT PRIMARY KEY, login TEXT, server TEXT, created INTEGER, payload TEXT)")
        a=mt5.account_info()
        if not a: raise ValueError("Account unavailable")
        for r in results:
            if r.get("candleTime") is None: continue
            key=json.dumps([str(a.login),a.server,r["symbol"],strategy,config,r["candleTime"]])
            db.execute("INSERT OR IGNORE INTO signals VALUES (?,?,?,?,?)",(key,str(a.login),a.server,r["scannedAt"],json.dumps(r,allow_nan=False)))
    return results
