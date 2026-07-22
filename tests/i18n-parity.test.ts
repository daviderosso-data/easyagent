import { describe, expect, test } from "vitest";
import { messages } from "@/i18n/messages";

// The EN dictionary is the source of truth; IT must mirror it exactly so no
// string silently falls back (or breaks) in one language only.
describe("i18n parity", () => {
  test("en and it expose the same keys", () => {
    const en = Object.keys(messages.en).sort();
    const it = Object.keys(messages.it).sort();
    expect(it).toEqual(en);
  });

  test("no dictionary value is empty", () => {
    for (const lang of ["en", "it"] as const) {
      for (const [key, value] of Object.entries(messages[lang])) {
        expect(value.trim(), `${lang}.${key}`).not.toBe("");
      }
    }
  });
});
