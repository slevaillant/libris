import { describe, it, expect, vi } from "vitest";
import { insertChunks } from "@/lib/chunks";
import type { SupabaseClient } from "@supabase/supabase-js";

const fakeClient = (failFirstBigBatch: boolean) => {
  const sizes: number[] = [];
  let failed = false;
  const client = {
    from: () => ({
      insert: async (rows: unknown[]) => {
        sizes.push(rows.length);
        if (failFirstBigBatch && rows.length > 5 && !failed) {
          failed = true;
          return { error: { message: "canceling statement due to statement timeout" } };
        }
        return { error: null };
      },
    }),
  } as unknown as SupabaseClient;
  return { client, sizes };
};

describe("insertChunks", () => {
  it("retries a timed-out batch in smaller pieces", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { client, sizes } = fakeClient(true);
    await insertChunks(client, Array.from({ length: 50 }, (_, i) => ({ i })));
    expect(sizes[0]).toBe(50); // timed out
    expect(sizes.slice(1)).toEqual([10, 10, 10, 10, 10]); // retried smaller
    vi.useRealTimers();
  });

  it("throws on non-timeout errors", async () => {
    const client = { from: () => ({ insert: async () => ({ error: { message: "permission denied" } }) }) } as unknown as SupabaseClient;
    await expect(insertChunks(client, [{ a: 1 }])).rejects.toThrow("permission denied");
  });
});
