import assert from "node:assert/strict";
import test from "node:test";

import type { DocumentConnectionContext } from "./auth.js";
import {
  documentPresenceColor,
  rewriteAuthenticatedPresence,
} from "./presence.js";

const context: DocumentConnectionContext = {
  documentId: "550e8400-e29b-41d4-a716-446655440000",
  sessionId: "session-id",
  userAvatar: "/avatar.png",
  userId: "user-id",
  userName: "林晓",
};

test("presence colors are stable", () => {
  assert.equal(documentPresenceColor("user-id"), documentPresenceColor("user-id"));
  assert.match(documentPresenceColor("user-id"), /^#[0-9a-f]{6}$/i);
});

test("authenticated identity replaces client supplied presence identity", () => {
  const states = new Map<number, Record<string, unknown>>([
    [
      42,
      {
        cursor: { anchor: 3, head: 5 },
        user: {
          avatar: "https://attacker.example/tracker.png",
          color: "#000000",
          id: "victim-id",
          name: "冒充用户",
        },
      },
    ],
  ]);

  rewriteAuthenticatedPresence(states, context);

  assert.deepEqual(states.get(42), {
    cursor: { anchor: 3, head: 5 },
    user: {
      avatar: "/avatar.png",
      color: documentPresenceColor("user-id"),
      id: "user-id",
      name: "林晓",
    },
  });
});
