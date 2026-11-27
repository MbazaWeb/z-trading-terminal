import { createHmac, timingSafeEqual } from "node:crypto";
export function issueSession(login: string, server: string, key: string) {
  const body = Buffer.from(JSON.stringify({login,server,exp:Date.now()+900000})).toString("base64url");
  return body+"."+createHmac("sha256",key).update(body).digest("base64url");
}
export function readSession(token: string, key: string): {login:string;server:string}|null {
  try {
    const [body,signature,extra]=token.split(".");
    if (!body || !signature || extra) return null;
    const expected=createHmac("sha256",key).update(body).digest();
    const actual=Buffer.from(signature,"base64url");
    if(actual.length!==expected.length || !timingSafeEqual(actual,expected)) return null;
    const data=JSON.parse(Buffer.from(body,"base64url").toString());
    if(!/^\d{1,15}$/.test(data.login)||typeof data.server!=="string"||!Number.isFinite(data.exp)||data.exp<=Date.now()) return null;
    return {login:data.login,server:data.server};
  } catch {return null;}
}
