import { validateNativeMarket, type NativeMarket } from "./nativeMarket";

type Direction = "BUY" | "SELL" | "HOLD";
type Candidate = { strategy: string; action: Direction; reason: string };
const mean = (xs: readonly number[]) => xs.reduce((a,b)=>a+b,0)/xs.length;
function bands(xs: number[]) {
  const mid=mean(xs);
  const sd=Math.sqrt(mean(xs.map(x=>(x-mid)**2)));
  return {mid,sd};
}
export function nativeStrategies(market: NativeMarket, now=Date.now()): Candidate[] {
  validateNativeMarket(market,now);
  const closes=market.candles.map(c=>c.close);
  const last=closes[closes.length-1], prev=closes[closes.length-2];
  const fast=mean(closes.slice(-10)), slow=mean(closes.slice(-30));
  const previousFast=mean(closes.slice(-11,-1)), previousSlow=mean(closes.slice(-31,-1));
  const b=bands(closes.slice(-21,-1));
  const prior=market.candles.slice(-21,-1);
  const high=Math.max(...prior.map(c=>c.high)), low=Math.min(...prior.map(c=>c.low));
  const result: Candidate[]=[
    {strategy:"momentum-native-v1",action:fast>slow&&previousFast<=previousSlow?"BUY":fast<slow&&previousFast>=previousSlow?"SELL":"HOLD",reason:"10/30 closed-candle moving average crossover"},
    {strategy:"reversion-native-v1",action:b.sd>0&&prev<b.mid-2*b.sd&&last>=b.mid-2*b.sd&&last<b.mid?"BUY":b.sd>0&&prev>b.mid+2*b.sd&&last<=b.mid+2*b.sd&&last>b.mid?"SELL":"HOLD",reason:"Return inside prior 20-candle Bollinger envelope"},
    {strategy:"breakout-native-v1",action:last>high?"BUY":last<low?"SELL":"HOLD",reason:"Close beyond preceding 20-candle range"},
    {strategy:"double-bollinger-native-v1",action:b.sd>0&&last>b.mid+b.sd&&last<=b.mid+2*b.sd&&fast>slow?"BUY":b.sd>0&&last<b.mid-b.sd&&last>=b.mid-2*b.sd&&fast<slow?"SELL":"HOLD",reason:"One-to-two standard deviation trend zone"}
  ];
  return result;
}
