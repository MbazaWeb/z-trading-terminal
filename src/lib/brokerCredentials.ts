import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const secret = process.env.BROKER_CREDENTIALS_KEY?.trim();
  if (!secret) throw new Error("BROKER_CREDENTIALS_KEY is not configured");
  const raw = Buffer.from(secret, secret.length === 64 ? "hex" : "base64");
  if (raw.length !== 32) throw new Error("BROKER_CREDENTIALS_KEY must contain 32 bytes");
  return raw;
}

export function encryptCredential(plaintext: string): { ciphertext: string; iv: string; keyId: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([encrypted, tag]).toString("base64"),
    iv: iv.toString("base64"),
    keyId: "brokers-v1",
  };
}

export function decryptCredential(ciphertext: string, iv: string): string {
  const ivBuffer = Buffer.from(iv, "base64");
  const payload = Buffer.from(ciphertext, "base64");
  if (payload.length < 16) throw new Error("Invalid encrypted credential");
  const decipher = createDecipheriv("aes-256-gcm", key(), ivBuffer);
  decipher.setAuthTag(payload.subarray(payload.length - 16));
  const encrypted = payload.subarray(0, payload.length - 16);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
