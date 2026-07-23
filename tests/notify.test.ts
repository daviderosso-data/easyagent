import { describe, expect, test } from "vitest";
import { LONG_TURN_MS, shouldNotify } from "@/lib/notify";

const base = { enabled: true, permission: "granted" as const, focused: false };

describe("shouldNotify", () => {
  test("never notifies when off, unpermitted, or the app has focus", () => {
    expect(shouldNotify({ ...base, enabled: false, kind: "approval" })).toBe(false);
    expect(shouldNotify({ ...base, permission: "denied", kind: "approval" })).toBe(false);
    expect(shouldNotify({ ...base, permission: "default", kind: "approval" })).toBe(false);
    expect(shouldNotify({ ...base, permission: "unsupported", kind: "approval" })).toBe(false);
    expect(shouldNotify({ ...base, focused: true, kind: "approval" })).toBe(false);
  });

  test("approvals, errors and orchestration outcomes notify regardless of duration", () => {
    expect(shouldNotify({ ...base, kind: "approval" })).toBe(true);
    expect(shouldNotify({ ...base, kind: "turnError" })).toBe(true);
    expect(shouldNotify({ ...base, kind: "orchDone" })).toBe(true);
    expect(shouldNotify({ ...base, kind: "orchError" })).toBe(true);
  });

  test("finished turns notify only when long", () => {
    expect(shouldNotify({ ...base, kind: "turnDone" })).toBe(false);
    expect(shouldNotify({ ...base, kind: "turnDone", durationMs: LONG_TURN_MS - 1 })).toBe(false);
    expect(shouldNotify({ ...base, kind: "turnDone", durationMs: LONG_TURN_MS })).toBe(true);
  });
});
