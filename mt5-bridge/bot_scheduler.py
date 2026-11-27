"""Single-process demo scheduler; stopped on restart."""
import threading
import time
from collections import deque

class Bot:
    def __init__(self, execute):
        self.execute=execute
        self.guard=threading.Lock()
        self.wake=threading.Event()
        self.state="stopped"
        self.config=None
        self.busy=False
        self.events=deque(maxlen=100)
        self.thread=threading.Thread(target=self.loop,daemon=True,name="demo-bot")
        self.thread.start()

    def control(self, action, config=None):
        with self.guard:
            if action=="start":
                if self.busy or self.state=="running": raise ValueError("Bot already active")
                self.config=config
                self.state="running"
            elif action=="pause": self.state="paused"
            elif action=="stop": self.state="stopped"
            else: raise ValueError("Invalid action")
            self.wake.set()

    def snapshot(self):
        with self.guard:
            return {"state":self.state,"busy":self.busy,"events":list(self.events),"intervalSeconds":45}

    def loop(self):
        while True:
            self.wake.wait(45)
            self.wake.clear()
            with self.guard:
                if self.state!="running" or self.busy: continue
                self.busy=True
                config=self.config
            try:
                result=self.execute(config)
                with self.guard:
                    self.events.appendleft({"time":time.time(),"result":result})
                    if any(x.get("status")=="uncertain" for x in result.get("outcomes",[])):
                        self.state="paused"
            except Exception as e:
                with self.guard:
                    self.events.appendleft({"time":time.time(),"error":str(getattr(e,"detail","Bot cycle failed"))})
                    self.state="paused"
            finally:
                with self.guard: self.busy=False
