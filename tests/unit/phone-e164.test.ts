import { describe, expect, it } from "vitest";

import { toE164Br } from "@shared/whatsapp/phone-e164";

import { E164_CASES } from "../support/e164-cases";


describe("toE164Br", () => {
  it.each(E164_CASES)("%s → %s", (input, expected) => {
    expect(toE164Br(input)).toBe(expected);
  });
});
