import type { DocumentConnectionContext } from "./auth.js";

const presenceColors = [
  "#0284c7",
  "#0d9488",
  "#7c3aed",
  "#ea580c",
  "#e11d48",
  "#4f46e5",
  "#16a34a",
  "#ca8a04",
];

export function rewriteAuthenticatedPresence(
  states: Map<number, Record<string, unknown>>,
  context: DocumentConnectionContext,
): void {
  for (const state of states.values()) {
    state.user = {
      avatar: context.userAvatar,
      color: documentPresenceColor(context.userId),
      id: context.userId,
      name: context.userName,
    };
  }
}

export function documentPresenceColor(userId: string): string {
  let hash = 2166136261;
  for (const character of userId) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return presenceColors[(hash >>> 0) % presenceColors.length] ?? "#0284c7";
}
