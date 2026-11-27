"""Conservative broker response classification. Never retries a submission."""
def classify(mt5, result, verified=True, require_deal=True):
    if result is None:
        return "uncertain"
    if result.retcode == mt5.TRADE_RETCODE_DONE:
        return "confirmed" if verified and (not require_deal or getattr(result,"deal",0)) else "uncertain"
    definitive=("TRADE_RETCODE_REJECT","TRADE_RETCODE_INVALID","TRADE_RETCODE_INVALID_VOLUME","TRADE_RETCODE_INVALID_PRICE","TRADE_RETCODE_INVALID_STOPS","TRADE_RETCODE_TRADE_DISABLED","TRADE_RETCODE_MARKET_CLOSED","TRADE_RETCODE_NO_MONEY","TRADE_RETCODE_INVALID_FILL")
    if not getattr(result,"deal",0) and not getattr(result,"order",0) and any(result.retcode==getattr(mt5,name,None) for name in definitive):
        return "rejected"
    return "uncertain"
