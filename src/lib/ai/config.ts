// Server-side configuration. Prices must be verified for the selected API model.
export const MONTHLY_LIMIT_MICRO_USD = 4_500_000;
export const DAILY_LIMIT_MICRO_USD = 150_000;
export const MAX_DAILY_REQUESTS = 100;
export const MAX_OUTPUT_TOKENS = 500;
export function readAIConfig() {
  if (process.env.AI_ENABLED !== "true") throw new Error("AI disabled");
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL_PRIMARY?.trim();
  const inputRate = Number(process.env.AI_INPUT_USD_PER_MILLION);
  const outputRate = Number(process.env.AI_OUTPUT_USD_PER_MILLION);
  if (!apiKey || !model || !Number.isFinite(inputRate) || inputRate <= 0 ||
      !Number.isFinite(outputRate) || outputRate <= 0) {
    throw new Error("AI configuration or verified pricing missing");
  }
  return { apiKey, model, inputRate, outputRate };
}
export function estimateMicroUsd(inputTokens: number, outputTokens: number, inputRate: number, outputRate: number) {
  if (![inputTokens, outputTokens, inputRate, outputRate].every(Number.isFinite) ||
      inputTokens < 0 || outputTokens < 0 || inputRate <= 0 || outputRate <= 0) throw new Error("Invalid cost estimate");
  const cost = Math.ceil(inputTokens * inputRate + outputTokens * outputRate);
  if (!Number.isSafeInteger(cost) || cost <= 0) throw new Error("Invalid reservation");
  return cost;
}
