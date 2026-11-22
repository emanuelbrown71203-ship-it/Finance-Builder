"use client";

/*
 * Talking with Nickel, using only what the phone or browser already has:
 * its own speech recognition (the same as the microphone on the keyboard)
 * to hear, and its own voice to answer. No AI service, no keys, no cost.
 *
 * On an iPhone this is Apple's speech recognition; in Chrome on a laptop the
 * browser sends the audio to Google to turn into words. Either way only the
 * words come back to Passbook. Replies are spoken with a voice on the device
 * itself where there is one, so balances aren't sent anywhere to be read out.
 */

type Result = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { results: ArrayLike<Result> };
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** True when this browser can turn speech into words. */
export function canListen(): boolean {
  return recognitionClass() !== null;
}

export type ListenError = "not-allowed" | "no-speech" | "other";

/**
 * Listens for one thing said. Calls back with the words as they come, then the final words. Returns a way
 * to cancel: after that, nothing more is called back (words heard while closing are dropped, not acted on).
 */
export function listen(handlers: { onWords: (words: string) => void; onDone: (final: string) => void; onError: (e: ListenError) => void }): () => void {
  const Rec = recognitionClass();
  if (!Rec) {
    handlers.onError("other");
    return () => {};
  }
  const rec = new Rec();
  rec.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let words = "";
  let failed = false;
  let cancelled = false;
  rec.onresult = (e) => {
    if (cancelled) return;
    words = Array.from(e.results)
      .map((r) => r[0].transcript)
      .join("")
      .trim();
    handlers.onWords(words);
  };
  rec.onerror = (e) => {
    failed = true;
    if (cancelled) return;
    handlers.onError(e.error === "not-allowed" || e.error === "service-not-allowed" ? "not-allowed" : e.error === "no-speech" ? "no-speech" : "other");
  };
  rec.onend = () => {
    if (!failed && !cancelled) handlers.onDone(words);
  };
  try {
    rec.start();
  } catch {
    handlers.onError("other");
  }
  return () => {
    cancelled = true;
    try {
      rec.abort();
    } catch {}
  };
}

/** Stage directions like "*happy beeps*" are for reading, not saying. */
export function forSpeaking(text: string): string {
  return text
    .replace(/\*[^*]+\*/g, " ")
    .replace(/[“”"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Says something in a small, bright robot-dog voice. On an iPhone the first
 * time has to come from a tap, so `prime` is called from the microphone button.
 * Returns a way to cancel: then `onEnd` is never called.
 */
export function speak(text: string, onEnd?: () => void): () => void {
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
  };
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    onEnd?.();
    return cancel;
  }
  const said = forSpeaking(text);
  if (!said) {
    onEnd?.();
    return cancel;
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(said);
  u.lang = "en-US";
  u.pitch = 1.6;
  u.rate = 1.06;
  // A voice on the device itself, so what's said (balances included) isn't sent off to be read out.
  const voices = synth.getVoices().filter((v) => v.lang.startsWith("en") && v.localService !== false);
  const voice = voices.find((v) => /Samantha|Karen|Zira|Ava|Daniel/.test(v.name)) ?? voices[0];
  if (voice) u.voice = voice;
  let ended = false;
  const done = () => {
    if (ended) return;
    ended = true;
    if (!cancelled) onEnd?.();
  };
  u.onend = done;
  u.onerror = done;
  // Some browsers never say they've finished; don't wait for ever.
  window.setTimeout(done, Math.min(20_000, 1500 + said.length * 80));
  synth.speak(u);
  return cancel;
}

/** Lets the phone speak later without a tap (iPhones only allow the first words from a tap). */
export function prime() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {}
}

export function hush() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

/**
 * "Yes", "yeah, do it", "go ahead" / "no", "cancel", "wait". Any sign of a no
 * wins ("please don't", "okay wait", "absolutely not", "yes but change it"),
 * and only a short, plain yes counts as yes: when in doubt, nothing happens.
 */
export function yesOrNo(words: string): "yes" | "no" | null {
  const w = words.toLowerCase().replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim();
  if (!w) return null;
  if (/\b(no|nope|nah|not|don'?t|do not|cancel|stop|wait|hold|change|never ?mind|but|later|wrong)\b/.test(w)) return "no";
  if (w.split(" ").length <= 4 && /^(yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|go for it|confirm|sounds good|correct|that's right|absolutely|definitely)( (please|do it|go ahead|thanks|thank you|nickel))*$/.test(w)) return "yes";
  return null;
}
