import { describe, expect, it } from "vitest";
import { forSpeaking, yesOrNo } from "@/components/nickel/voice";

describe("hearing yes or no", () => {
  it("takes only a short, plain yes as yes", () => {
    for (const w of ["yes", "Yeah", "yep", "sure", "okay", "do it", "yes please", "go ahead", "yeah do it"]) expect(yesOrNo(w), w).toBe("yes");
  });
  it("lets any sign of a no win", () => {
    for (const w of ["no", "nope", "please don't", "please cancel", "ok wait", "okay no", "absolutely not", "definitely not", "yes but change the date", "not now", "hold on"]) expect(yesOrNo(w), w).toBe("no");
  });
  it("does nothing when it's unclear", () => {
    for (const w of ["", "hmm", "what's left to spend", "sure thing buddy, and also add a goal"]) expect(yesOrNo(w), w).toBeNull();
  });
});

describe("what's said out loud", () => {
  it("leaves out stage directions and quote marks", () => {
    expect(forSpeaking("*happy beeps* “Japan” is on track!")).toBe("Japan is on track!");
  });
});
