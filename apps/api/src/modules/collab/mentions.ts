export interface MentionUser {
  id: string;
  displayName: string;
}
export interface Mention {
  userId: string;
  displayName: string;
}

/** `\p{L}` keeps Hebrew, Latin and digits; everything else ends the token. */
const TOKEN = /[\p{L}\p{N}._'-]+/u;

/**
 * Resolves `@name` tokens in a comment against the people who can be mentioned.
 *
 * Display names here are routinely two words ("ענבר לוי"), so a single token after the
 * `@` is not enough: the text that follows the marker is matched against whole display
 * names first (longest wins, so "ענבר לוי" beats "ענבר"), and only if nothing matches
 * does it fall back to a prefix match on the first token. Matching is case-insensitive
 * and never reorders — the result keeps the order the names appear in the text, with
 * each person named at most once.
 */
export function parseMentions(text: string, users: readonly MentionUser[]): Mention[] {
  const byLength = [...users].sort((a, b) => b.displayName.length - a.displayName.length);
  const out: Mention[] = [];
  const seen = new Set<string>();
  const push = (u: MentionUser) => {
    if (seen.has(u.id)) return;
    seen.add(u.id);
    out.push({ userId: u.id, displayName: u.displayName });
  };

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '@') continue;
    const rest = text.slice(i + 1);
    const restLower = rest.toLowerCase();
    // A whole display name wins wherever it sits. Hebrew glues one-letter prepositions
    // straight onto the marker ("ל@ענבר", "ו@דנה"), so the preceding character cannot be
    // used to decide whether this is a mention at all.
    const exact = byLength.find((u) => u.displayName && restLower.startsWith(u.displayName.toLowerCase()));
    if (exact) {
      push(exact);
      i += exact.displayName.length;
      continue;
    }
    const token = TOKEN.exec(rest)?.[0];
    if (!token || rest.indexOf(token) !== 0) continue;
    // Only the loose prefix path can be fooled by an address: `inbar@wecom.co.il` looks
    // like `@wecom…` to it. A dotted token glued to a word is a domain, not a person.
    if (i > 0 && TOKEN.test(text[i - 1]) && token.includes('.')) {
      i += token.length;
      continue;
    }
    const lower = token.toLowerCase();
    const prefix = byLength.filter((u) => u.displayName.toLowerCase().startsWith(lower));
    // An ambiguous prefix ("@ע" with three matching people) names nobody rather than
    // notifying all three; the composer's autocomplete inserts the full name.
    if (prefix.length === 1) push(prefix[0]);
    i += token.length;
  }
  return out;
}
