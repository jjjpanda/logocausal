import { describe, expect, it } from "vitest";
import { settleLeader } from "./leader";
import type { Leader } from "./leader";

const initial: Leader = { key: "A", challenger: null, since: 0 };
const ranked = (b: number, a = 1) => [{ key: "B", score: b }, { key: "A", score: a }];

describe("readable group leadership", () => {
  it("keeps near ties stable with both an absolute and a relative margin", () => {
    expect(settleLeader(initial, ranked(1.09), 0)).toBe(initial);
    expect(settleLeader(initial, ranked(0.24, 0.2), 0)).toBe(initial);
    expect(settleLeader(initial, ranked(1), 0)).toBe(initial);
  });
  it("requires the same challenger to stay ahead for two seconds", () => {
    const pending = settleLeader(initial, ranked(1.2), 100);
    expect(pending.key).toBe("A");
    expect(settleLeader(pending, ranked(1.3), 2099)).toBe(pending);
    expect(settleLeader(pending, ranked(1.2), 2100).key).toBe("B");
  });
  it("restarts the waiting period when the lead is lost or another challenger takes over", () => {
    const pending = settleLeader(initial, ranked(1.2), 100);
    const lost = settleLeader(pending, ranked(1.01), 1000);
    expect(lost.challenger).toBeNull();
    expect(settleLeader(lost, ranked(1.2), 2100).since).toBe(2100);
    const other = settleLeader(pending, [{ key: "C", score: 2 }, ...ranked(1.2)], 1500);
    expect(other.challenger).toBe("C");
    expect(other.since).toBe(1500);
  });
  it("shows exact leaders when paused and immediately replaces an unavailable group", () => {
    expect(settleLeader(initial, ranked(1.01), 0, true).key).toBe("B");
    expect(settleLeader(initial, [{ key: "C", score: 0.1 }], 0).key).toBe("C");
    expect(settleLeader(initial, [], 0).key).toBeNull();
  });
});
