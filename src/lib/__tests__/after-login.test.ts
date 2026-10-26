import { describe, it, expect } from "vitest";
import { isSafeInternalPath } from "@/lib/after-login";

describe("isSafeInternalPath", () => {
  it("accepts in-app paths", () => {
    expect(isSafeInternalPath("/quiz/123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(isSafeInternalPath("/book/abc?tab=chapters")).toBe(true);
  });

  it("rejects external or looping destinations", () => {
    for (const p of ["//evil.com", "https://evil.com", "/\\evil.com", "/login", "quiz/1", "", null, undefined, 42]) {
      expect(isSafeInternalPath(p)).toBe(false);
    }
  });
});
