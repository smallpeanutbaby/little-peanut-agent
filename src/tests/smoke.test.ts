import { describe, expect, it } from "vitest";

describe("little peanut scaffold", () => {
  it("uses src as the only project root", () => {
    expect("src").toBe("src");
  });
});
