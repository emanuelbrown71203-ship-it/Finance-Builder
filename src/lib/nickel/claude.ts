/*
 * "Ask Claude": Nickel can open a chat in the owner's own Claude app with a
 * question ready. Claude reads the numbers through the private, read-only
 * Passbook connector the owner added in Claude's settings; the link itself
 * carries only the question, never any numbers or names.
 */

export const CLAUDE_QUESTIONS = [
  "How is this month going so far?",
  "Where did my money go this month, compared with last month?",
  "How are my savings goals doing, and what would it take to reach each one on time?",
  "Which bills and subscriptions cost the most, and did any go up?",
] as const;

/** Tells Claude where to look, so it uses the connector instead of guessing. */
export const CLAUDE_PREFIX = "Look at my Passbook (the Passbook connector) and answer: ";

/** A link that opens a new Claude chat with the question typed in. */
export function claudeLink(question: string): string {
  return `https://claude.ai/new?q=${encodeURIComponent(CLAUDE_PREFIX + question.trim().slice(0, 500))}`;
}
