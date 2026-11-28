// Position reconciliation between local state and broker.
// Compares positions stored in Supabase with positions on the MetaApi broker.
// Closes local positions that no longer exist on the broker (broker already closed them).
// Logs discrepancies for manual review (ZT-12).

import { getConnectedRpcConnection, readMetaApiConfig } from "./metaApiServer";

export interface ReconciliationResult {
  matched: number;
  localOnly: number;
  brokerOnly: number;
  closedLocally: string[];
  discrepancies: string[];
  timestamp: string;
}

/**
 * Reconcile local positions with broker positions.
 * Call this at the start of each cron cycle to keep state in sync.
 */
export async function reconcilePositions(
  localPositions: Array<{
    id: string;
    brokerOrderId?: string | null;
    symbol: string;
    side: string;
    entryPrice: number;
  }>,
): Promise<ReconciliationResult> {
  const result: ReconciliationResult = {
    matched: 0,
    localOnly: 0,
    brokerOnly: 0,
    closedLocally: [],
    discrepancies: [],
    timestamp: new Date().toISOString(),
  };

  const config = readMetaApiConfig();
  if (!config) {
    // No broker to reconcile against — all positions are local
    result.localOnly = localPositions.length;
    return result;
  }

  let brokerPositions: any[] = [];
  try {
    const { connection } = await getConnectedRpcConnection();
    const positions = await connection.getPositions();
    brokerPositions = positions || [];
  } catch (err) {
    result.discrepancies.push(
      `Broker position fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return result;
  }

  // Build a map of broker positions by their ID
  const brokerById = new Map<string, any>();
  for (const bp of brokerPositions) {
    const id = String(bp.id || bp.ticket);
    if (id) brokerById.set(id, bp);
  }

  // Check each local position against the broker
  for (const local of localPositions) {
    if (!local.brokerOrderId) {
      // Paper trade — no broker position to match
      continue;
    }
    const brokerPos = brokerById.get(String(local.brokerOrderId));
    if (brokerPos) {
      result.matched++;
    } else {
      // Position exists locally but not on broker — broker already closed it
      result.localOnly++;
      result.closedLocally.push(local.id);
    }
  }

  // Check for broker positions not in local state (orphaned)
  const localOrderIds = new Set(
    localPositions
      .filter((p) => p.brokerOrderId)
      .map((p) => String(p.brokerOrderId)),
  );
  for (const bp of brokerPositions) {
    const id = String(bp.id || bp.ticket);
    if (id && !localOrderIds.has(id)) {
      result.brokerOnly++;
      result.discrepancies.push(
        `Orphaned broker position: ${id} (${bp.symbol || "unknown"})`,
      );
    }
  }

  return result;
}
