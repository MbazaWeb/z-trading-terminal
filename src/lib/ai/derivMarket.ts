import "server-only";
import { z } from "zod";

const URL = "wss://api.derivws.com/trading/v1/options/ws/public";
const positive = z.number().finite().positive();
const candleSchema = z.object({ epoch: z.number().int().positive(), open: positive, high: positive, low: positive, close: positive });
let active = 0;
export async function getDerivMarket(symbol: string) {
  if (!/^\w{2,30}$/.test(symbol)) throw new Error("Invalid Deriv symbol");
  if (active >= 5) throw new Error("Deriv market adapter busy");
  active++;
  try {
    return await new Promise<{ provider: "deriv"; symbol: string; observedAt: number; quote: number; candles: Array<{time:number;open:number;high:number;low:number;close:number}>; volumeType: "unavailable"; executable: false }>((resolve,reject) => {
      const ws = new WebSocket(URL);
      const replies = new Map<number, unknown>();
      let finished = false;
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        try { ws.close(); } catch { /* closed */ }
        if (error) reject(error);
      };
      const timer = setTimeout(() => finish(new Error("Deriv market timeout")), 10000);
      ws.onopen = () => {
        try {
          ws.send(JSON.stringify({active_symbols:"brief",req_id:1}));
          ws.send(JSON.stringify({ticks:symbol,subscribe:1,req_id:2}));
          ws.send(JSON.stringify({ticks_history:symbol,end:"latest",style:"candles",granularity:60,count:151,req_id:3}));
        } catch { finish(new Error("Deriv request failed")); }
      };
      ws.onerror = () => finish(new Error("Deriv connection failed"));
      ws.onclose = () => finish(new Error("Deriv connection closed"));
      ws.onmessage = event => {
        if (finished) return;
        try {
          if (typeof event.data !== "string") throw new Error("Invalid message");
          const msg = JSON.parse(event.data);
          if (msg.error) throw new Error("Deriv rejected market request");
          if (![1,2,3].includes(msg.req_id)) return;
          replies.set(msg.req_id,msg);
          if (replies.size !== 3) return;
          const listing = z.object({active_symbols:z.array(z.object({underlying_symbol:z.string(),exchange_is_open:z.literal(1),is_trading_suspended:z.literal(0)}).or(z.object({underlying_symbol:z.string(),exchange_is_open:z.number(),is_trading_suspended:z.number()})))}).parse(replies.get(1));
          if (!listing.active_symbols.some(s=>s.underlying_symbol===symbol && s.exchange_is_open===1 && s.is_trading_suspended===0)) throw new Error("Deriv market unavailable");
          const {tick} = z.object({tick:z.object({symbol:z.literal(symbol),quote:positive,epoch:z.number().int().positive()})}).parse(replies.get(2));
          const now = Date.now();
          const observedAt = tick.epoch*1000;
          if (observedAt>now || now-observedAt>60000) throw new Error("Stale Deriv tick");
          const history = z.object({candles:z.array(candleSchema).max(151)}).parse(replies.get(3));
          const candles = history.candles.filter(c=>c.epoch*1000+60000<=now).map(c=>({time:c.epoch*1000,open:c.open,high:c.high,low:c.low,close:c.close}));
          if(candles.length<50 || now-candles[candles.length-1].time-60000>120000 || candles.some((c,i)=>c.low>Math.min(c.open,c.close)||c.high<Math.max(c.open,c.close)||(i>0&&c.time<=candles[i-1].time))) throw new Error("Invalid Deriv candles");
          finish();
          resolve({provider:"deriv",symbol,observedAt,quote:tick.quote,candles,volumeType:"unavailable",executable:false});
        } catch { finish(new Error("Deriv market validation failed")); }
      };
    });
  } finally { active--; }
}
