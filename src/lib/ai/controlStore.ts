import type { PrismaClient } from "@prisma/client";
import { AGENT_REGISTRY } from "@/lib/agents/registry";

type ControlRow = { running: boolean; emergency_stop: boolean; enabled_agent_ids: string[]; revision: bigint };
export async function getAIControls(db: PrismaClient, userId: string) {
  const rows = await db.$queryRaw<ControlRow[]>`SELECT running, emergency_stop, enabled_agent_ids, revision FROM private.ai_controls WHERE user_id = ${userId}::uuid`;
  const row = rows[0];
  return row ? { running: row.running, emergencyStop: row.emergency_stop, enabledAgentIds: row.enabled_agent_ids, revision: row.revision.toString() } :
    { running: false, emergencyStop: true, enabledAgentIds: [], revision: "0" };
}
// Internal only: caller must derive userId from verified application identity.
export async function setAIControls(db: PrismaClient, userId: string, next: {
  running: boolean; emergencyStop: boolean; enabledAgentIds: string[]; revision: string;
}) {
  const ids = [...new Set(next.enabledAgentIds)];
  if (ids.some(id => !AGENT_REGISTRY.some(a => a.id === id)) ||
      !/^\d{1,18}$/.test(next.revision) || (next.running && next.emergencyStop)) throw new Error("Invalid AI controls");
  if (next.running && !["risk","stopLoss","stopWin"].every(id => ids.includes(id))) throw new Error("Required risk agents disabled");
  return db.$transaction(async tx => {
    await tx.$executeRaw`INSERT INTO private.ai_controls(user_id) VALUES (${userId}::uuid) ON CONFLICT DO NOTHING`;
    const count = await tx.$executeRaw`UPDATE private.ai_controls SET running = ${next.running}, emergency_stop = ${next.emergencyStop}, enabled_agent_ids = ${ids}::text[], revision = revision + 1, updated_at = now() WHERE user_id = ${userId}::uuid AND revision = ${BigInt(next.revision)}`;
    if (count !== 1) throw new Error("AI controls changed; reload before updating");
    return { revision: (BigInt(next.revision) + BigInt(1)).toString() };
  });
}
