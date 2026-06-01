import { describe, it, expect } from "vitest";
import { z } from "zod";
import { extractFirstJsonObject, formatZodError, round2, clamp } from "./util.js";

describe("extractFirstJsonObject (evaluation.md §4)", () => {
  it("parses a bare object", () => {
    expect(extractFirstJsonObject('{"a":1}')).toEqual({ a: 1 });
  });
  it("ignores prose around the object", () => {
    const text = 'Sure! Here is my answer:\n{"verdict":"advance","n":2}\nHope that helps.';
    expect(extractFirstJsonObject(text)).toEqual({ verdict: "advance", n: 2 });
  });
  it("ignores a ```json code fence", () => {
    const text = "```json\n{\"score\": 8}\n```";
    expect(extractFirstJsonObject(text)).toEqual({ score: 8 });
  });
  it("handles nested objects", () => {
    const text = 'noise {"a":{"b":{"c":3}},"d":4} trailing';
    expect(extractFirstJsonObject(text)).toEqual({ a: { b: { c: 3 } }, d: 4 });
  });
  it("does not stop on braces inside strings", () => {
    expect(extractFirstJsonObject('{"k":"a } b { c"}')).toEqual({ k: "a } b { c" });
  });
  it("handles escaped quotes inside strings", () => {
    expect(extractFirstJsonObject('{"k":"she said \\"hi\\""}')).toEqual({ k: 'she said "hi"' });
  });
  it("throws when there is no object", () => {
    expect(() => extractFirstJsonObject("no json here")).toThrow();
  });
  it("throws when the object is unbalanced", () => {
    expect(() => extractFirstJsonObject('{"a":1')).toThrow();
  });
});

describe("round2 / clamp", () => {
  it("round2 rounds to 2 decimals", () => {
    expect(round2(7.105)).toBe(7.11);
    expect(round2(6.3)).toBe(6.3);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
  it("clamp bounds to [min,max]", () => {
    expect(clamp(11, 1, 10)).toBe(10);
    expect(clamp(0, 1, 10)).toBe(1);
    expect(clamp(7, 1, 10)).toBe(7);
  });
});

describe("formatZodError", () => {
  it("lists path and message per issue", () => {
    const schema = z.object({ score: z.number().int().min(1).max(10) });
    const res = schema.safeParse({ score: 99 });
    expect(res.success).toBe(false);
    if (!res.success) {
      const msg = formatZodError(res.error);
      expect(msg).toContain("score");
    }
  });
});
