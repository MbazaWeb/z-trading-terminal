import os
import secrets
import threading
import MetaTrader5 as mt5
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, SecretStr, Field

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
lock = threading.Lock()

class Credentials(BaseModel):
    login: int = Field(gt=0)
    password: SecretStr
    server: str = Field(min_length=1, max_length=128)

@app.post("/verify")
def verify(body: Credentials, authorization: str = Header(default="")):
    key = os.environ.get("MT5_BRIDGE_KEY", "")
    if len(key) < 32 or not secrets.compare_digest(authorization, "Bearer " + key):
        raise HTTPException(401, "Unauthorized")
    with lock:
        try:
            if not mt5.initialize(login=body.login, password=body.password.get_secret_value(), server=body.server, timeout=15000):
                raise HTTPException(502, "MT5 connection failed")
            account = mt5.account_info()
            terminal = mt5.terminal_info()
            if account is None or terminal is None or not terminal.connected or account.login != body.login or account.server != body.server:
                raise HTTPException(502, "Account verification failed")
            if account.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO:
                raise HTTPException(403, "Only demo accounts are supported in this phase")
            return {"loginid": str(account.login), "accountType": "demo", "currency": account.currency,
                    "balance": account.balance, "equity": account.equity, "freeMargin": account.margin_free,
                    "leverage": account.leverage, "server": account.server, "name": account.name, "email": ""}
        finally:
            mt5.shutdown()
