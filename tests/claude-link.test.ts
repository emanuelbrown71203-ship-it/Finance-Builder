import { describe, expect, it } from "vitest";
import { CLAUDE_QUESTIONS, claudeLink } from "@/lib/nickel/claude";

describe("asking Claude from Nickel", () => {
  it("opens a new Claude chat with only the question in the link", () => {
    const link = new URL(claudeLink(CLAUDE_QUESTIONS[0]));
    expect(link.origin).toBe("https://claude.ai");
    expect(link.pathname).toBe("/new");
    expect(link.searchParams.get("q")).toBe("Look at my Passbook (the Passbook connector) and answer: How is this month going so far?");
    // Nothing but the question travels in the address: no amounts, names or keys.
    expect([...link.searchParams.keys()]).toEqual(["q"]);
  });

  it("keeps an odd question safe inside the link", () => {
    const link = new URL(claudeLink("Rent & bills? #1 / 50% off" + "x".repeat(800)));
    expect(link.searchParams.get("q")).toContain("Rent & bills? #1 / 50% off");
    expect(link.searchParams.get("q")!.length).toBeLessThan(600);
    expect(link.hash).toBe("");
  });
});
