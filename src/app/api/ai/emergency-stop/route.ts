import { NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth/session";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const session = await requireAdmin();
    if (request.headers.get("origin") !== new URL(request.url).origin) {
      return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    }
    await db.$executeRaw`INSERT INTO private.ai_controls(user_id, running, emergency_stop)
      VALUES (${session.userId}::uuid, false, true)
      ON CONFLICT (user_id) DO UPDATE SET running = false, emergency_stop = true,
      revision = private.ai_controls.revision + 1, updated_at = now()`;
    return NextResponse.json({ running: false, emergencyStop: true, scope: "ai-advisory-controls" });
  } catch (error) {
    return NextResponse.json({ error: "Emergency stop not confirmed" },
      { status: error instanceof AuthError ? error.statusCode : 503 });
  }
}
