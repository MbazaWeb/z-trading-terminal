"""Broker-deal analytics and conservative feedback; never changes settings."""
import json
from collections import Counter, defaultdict

def summarize(mt5, deals, db, account):
    groups=defaultdict(list)
    for d in deals:
        if d.type in (mt5.DEAL_TYPE_BUY,mt5.DEAL_TYPE_SELL) and d.position_id:
            groups[d.position_id].append(d)
    db.execute("CREATE TABLE IF NOT EXISTS agent_events (id TEXT PRIMARY KEY, login TEXT, server TEXT, created REAL, payload TEXT)")
    journal=[(created,json.loads(payload)) for created,payload in db.execute("SELECT created,payload FROM agent_events WHERE login=? AND server=? AND created>=strftime('%s','now','-30 days')",(str(account.login),account.server))]
    by_deal=defaultdict(list)
    for _,e in journal:
        if e.get("status")=="confirmed" and e.get("deal"):
            by_deal[str(e["deal"])].append(e)
    closed=[]
    excluded=0
    for pid, rows in groups.items():
        rows.sort(key=lambda d:(d.time_msc,d.ticket))
        entries=[d for d in rows if d.entry==mt5.DEAL_ENTRY_IN]
        exits=[d for d in rows if d.entry==mt5.DEAL_ENTRY_OUT]
        if not entries or not exits or len(entries)+len(exits)!=len(rows) or abs(sum(d.volume for d in entries)-sum(d.volume for d in exits))>1e-8:
            excluded+=1
            continue
        matched=by_deal.get(str(entries[0].ticket),[]) if len(entries)==1 else []
        strategy=matched[0].get("candidate",{}).get("signal",{}).get("strategy") if len(matched)==1 else None
        reason_names={getattr(mt5,"DEAL_REASON_SL",-100):"Stop loss",getattr(mt5,"DEAL_REASON_TP",-101):"Take profit",getattr(mt5,"DEAL_REASON_SO",-102):"Stop out"}
        closed.append({"strategy":strategy or "Unattributed","openedAt":entries[0].time_msc,"exitLabel":reason_names.get(exits[-1].reason,"Other broker exit"),"commission":sum(d.commission for d in rows),"swap":sum(d.swap for d in rows),"fees":sum(d.fee for d in rows),"positionId":str(pid),"symbol":entries[0].symbol,"net":sum(d.profit+d.commission+d.swap+d.fee for d in rows),"closedAt":exits[-1].time_msc,"exitReason":int(exits[-1].reason),"managed":all(d.magic==260427 for d in entries)})
    def metrics(rows):
        wins=sum(r["net"]>0 for r in rows)
        loss=sum(-min(0,r["net"]) for r in rows)
        gain=sum(max(0,r["net"]) for r in rows)
        return {"trades":len(rows),"wins":wins,"losses":sum(r["net"]<0 for r in rows),"net":gain-loss,"winRate":100*wins/len(rows) if rows else None,"profitFactor":gain/loss if loss else None}
    db.execute("CREATE TABLE IF NOT EXISTS agent_events (id TEXT PRIMARY KEY, login TEXT, server TEXT, created REAL, payload TEXT)")
    events=Counter()
    reasons=Counter()
    strategies=defaultdict(Counter)
    for created,e in journal:
        status=e.get("status","unknown")
        events[status]+=1
        distinct={stage["reason"] for stage in e.get("stages",[]) if stage.get("status") in ("reject","blocked","uncertain")}
        if e.get("reason"): distinct.add(e["reason"])
        reasons.update(distinct)
        candidate=e.get("candidate",{}).get("signal",{})
        if candidate.get("strategy"): strategies[candidate["strategy"]][status]+=1
    managed=[r for r in closed if r["managed"]]
    m=metrics(managed)
    recommendations=[]
    if len(managed)<100: recommendations.append("Insufficient closed managed positions for reliable strategy changes; collect more demo evidence.")
    if m["profitFactor"] is not None and m["profitFactor"]<1: recommendations.append("Review losing positions and validate strategy changes out of sample before enabling them.")
    if events["uncertain"] or events["reserved"]: recommendations.append("Review unresolved execution records against broker history before further entries.")
    if excluded: recommendations.append("Incomplete or complex position histories excluded; review full broker history.")
    return {"byStrategy":{s:metrics([r for r in managed if r["strategy"]==s]) for s in sorted({r["strategy"] for r in managed})},"agentEvents":[{"created":created,**e} for created,e in journal],"all":metrics(closed),"managed":m,"bySymbol":{s:metrics([r for r in managed if r["symbol"]==s]) for s in sorted({r["symbol"] for r in managed})},"positions":sorted(closed,key=lambda r:r["closedAt"],reverse=True),"excluded":excluded,"executionStatuses":dict(events),"failureReasons":dict(reasons),"recommendations":recommendations}
