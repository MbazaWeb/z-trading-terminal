import { describe, it, expect } from "vitest";
import { priceDecimals, formatPrice, formatCompact, csvEscape } from "../format";

describe("priceDecimals", () => {
  it("returns 2 decimals for prices >= 1", () => {
    expect(priceDecimals(1)).toBe(2);
    expect(priceDecimals(100)).toBe(2);
    expect(priceDecimals(68000)).toBe(2);
  });

  it("returns 4 decimals for prices between 0.01 and 1", () => {
    expect(priceDecimals(0.5)).toBe(4);
    expect(priceDecimals(0.01)).toBe(4);
  });

  it("returns 6 decimals for prices below 0.01", () => {
    expect(priceDecimals(0.001)).toBe(6);
    expect(priceDecimals(0.0001)).toBe(6);
  });
});

describe("formatPrice", () => {
  it("formats integer prices with 2 decimals", () => {
    expect(formatPrice(100)).toBe("100.00");
  });

  it("formats large numbers with commas", () => {
    expect(formatPrice(68000)).toBe("68,000.00");
  });

  it("accepts custom decimals", () => {
    expect(formatPrice(0.5, 4)).toBe("0.5000");
  });
});

describe("formatCompact", () => {
  it("formats billions", () => {
    const result = formatCompact(1_000_000_000);
    expect(result).toMatch(/B/);
  });

  it("formats millions", () => {
    const result = formatCompact(1_000_000);
    expect(result).toMatch(/M/);
  });

  it("formats thousands", () => {
    const result = formatCompact(1_000);
    expect(result).toMatch(/K/);
  });
});

describe("csvEscape", () => {
  it("escapes commas", () => {
    expect(csvEscape("hello,world")).toBe('"hello,world"');
  });

  it("escapes quotes", () => {
    expect(csvEscape('hello"world')).toBe('"hello""world"');
  });

  it("does not escape plain text", () => {
    expect(csvEscape("hello")).toBe("hello");
  });

  it("passes numbers through", () => {
    expect(csvEscape(42)).toBe("42");
  });
});
