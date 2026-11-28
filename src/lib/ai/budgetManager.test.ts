import { describe, it, expect } from "vitest";
import { reserveAIRequest } from "./budgetManager";
import type { PrismaClient } from "@prisma/client";

function mockDb(monthly = 0, daily = 0, requests = 0) {
  const tx = {
    $queryRaw: async (sql: TemplateStringsArray) =>
      sql.join("").includes("pg_advisory")
        ? [{ locked: 1 }]
        : [{
            monthly: BigInt(monthly),
            daily: BigInt(daily),
            requests: BigInt(requests)
          }],
    $executeRaw: async () => 1
  };

  return {
    $transaction: async (fn: (value: typeof tx) => unknown) =>
      fn(tx)
  } as unknown as PrismaClient;
}

describe("AI budget protection", () => {
  it("allows an affordable request", async () => {
    expect(await reserveAIRequest(mockDb(), 1000))
      .toBeTruthy();
  });

  it("blocks monthly overspending", async () => {
    await expect(
      reserveAIRequest(mockDb(4499500), 1000)
    ).rejects.toThrow();
  });

  it("blocks daily overspending", async () => {
    await expect(
      reserveAIRequest(mockDb(149500, 149500), 1000)
    ).rejects.toThrow();
  });

  it("blocks requests beyond daily count", async () => {
    await expect(
      reserveAIRequest(mockDb(100000, 100000, 100), 1000)
    ).rejects.toThrow();
  });

  it("rejects negative reservations", async () => {
    await expect(
      reserveAIRequest(mockDb(), -1000)
    ).rejects.toThrow();
  });

  it("rejects invalid numeric reservations", async () => {
    await expect(
      reserveAIRequest(mockDb(), NaN)
    ).rejects.toThrow();
  });
});
