import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { serializeRecord, toDecimal } from "../../lib/api/serialize";

describe("API serialization helpers", () => {
  it("serializes nested bigint values as decimal strings", () => {
    expect(serializeRecord({ total: 1_234n, nested: [5n] })).toEqual({
      total: "1234",
      nested: ["5"],
    });
  });

  it("serializes Prisma Decimal values as strings", () => {
    expect(serializeRecord({ weight: new Prisma.Decimal("1.250") })).toEqual({
      weight: "1.25",
    });
  });

  it("preserves Date values as ISO strings in the JSON clone", () => {
    const createdAt = new Date("2026-07-20T12:34:56.000Z");

    expect(serializeRecord({ createdAt })).toEqual({
      createdAt: "2026-07-20T12:34:56.000Z",
    });
  });

  it("converts nullish decimal inputs to zero", () => {
    expect(toDecimal(null).toString()).toBe("0");
    expect(toDecimal(undefined).toString()).toBe("0");
  });

  it("converts string and numeric decimal inputs", () => {
    expect(toDecimal("12.50").toString()).toBe("12.5");
    expect(toDecimal(3).toString()).toBe("3");
  });
});
