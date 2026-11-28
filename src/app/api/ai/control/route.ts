import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, AuthError } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAIControls, setAIControls } from "@/lib/ai/controlStore";

export const dynamic = "force-dynamic";
const schema = z.object({ running: z.boolean(), emergencyStop: z.boolean(),
  enabledAgentIds: z.array(z.string().max(64)).max(16), revision: z.string().regex(/^\d{1,18}$/) }).strict();
function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof AuthError ? "Access denied" : "AI controls unavailable" },
    { status: error instanceof AuthError ? error.statusCode : 503 });
}
export async function GET() {
  try {
    const session = await requireAdmin();
    return NextResponse.json(await getAIControls(db, session.userId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const session = await requireAdmin();
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    const raw = await request.text();
    if (raw.length > 4096) return NextResponse.json({ error: "Request too large" }, { status: 413 });
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success) return NextResponse.json({ error: "Invalid settings" }, { status: 400 });
    const next = parsed.data;
    if (next.running && (next.emergencyStop || process.env.AI_ENABLED !== "true" ||
      !["risk","stopLoss","stopWin"].every(id => next.enabledAgentIds.includes(id)))) {
      return NextResponse.json({ error: "AI or required risk agents unavailable" }, { status: 409 });
    }
    await setAIControls(db, session.userId, next);
    return NextResponse.json(await getAIControls(db, session.userId));
  } catch (error) { return failure(error); }
}
