import "server-only";
import { getBridgeAccount, getBridgeMarket } from "@/lib/mt5BridgeServer";
import type { SessionData } from "@/lib/auth/session";

export async function getBrokerSnapshot(session: Pick<SessionData, "userId" | "provider" | "accountType" | "loginid">, symbol: string) {
  if (!process.env.ZT_OWNER_USER_ID || session.userId !== process.env.ZT_OWNER_USER_ID ||
      session.accountType !== "demo") throw new Error("Verified owner demo account required");
  if (session.provider !== "metatrader") throw new Error("Deriv native adapter not configured");
  const account = await getBridgeAccount();
  if (account.login !== session.loginid) throw new Error("Selected account does not match bridge");
  const market = await getBridgeMarket(symbol);
  return { account, market };
}
