"""Read-only recovery candidates; never authorize a retry or clear a ledger."""
from uuid import UUID

def match_deals(request_id: str, deals, *, expected_symbol: str, expected_type: int):
    tag = UUID(request_id).hex[:24]
    if deals is None:
        return {"status": "history_unavailable"}
    matches = [d for d in deals if getattr(d, "comment", None) == tag]
    if not matches:
        return {"status": "unresolved"}
    if len(matches) != 1:
        return {"status": "ambiguous"}
    deal = matches[0]
    if (getattr(deal, "symbol", None) != expected_symbol
        or getattr(deal, "type", None) != expected_type
        or getattr(deal, "entry", None) != 0
        or not isinstance(getattr(deal, "ticket", None), int)
        or deal.ticket <= 0):
        return {"status": "ambiguous"}
    return {"status": "candidate", "dealId": str(deal.ticket)}
