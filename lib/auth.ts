import { cookies } from "next/headers";
import { db } from "./db";
import { SESSION_COOKIE, verifyToken, VERIFY_TTL_MS, type Appearance } from "./sso";

/**
 * The session shape the rest of the app reads.
 *
 * `sub` is a string because that is what it was in elite-v2, where it came from
 * a JWT subject, and every caller already does `Number(session.sub)`. Keeping
 * the name and the type is what let the ported code stay unchanged.
 */
export interface Session {
  sub: string;
  email: string;
  role: "user" | "admin";
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  appearance?: Appearance;
}

/** When each mirrored account was last written. In-process only. */
const mirroredAt = new Map<number, number>();

/**
 * Mirror the account elite-v2 just vouched for, so the per-user tables
 * (progress, likes) have a row to reference.
 *
 * Refreshed on the verify window rather than on every call: getSession() runs
 * once per server component and once per media request, and rewriting the same
 * unchanged row each time is a serialized SQLite write per call.
 */
function mirrorUser(user: {
  id: number;
  email: string;
  role: string;
  username?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
}): void {
  const now = Date.now();
  const last = mirroredAt.get(user.id);
  if (last !== undefined && now - last < VERIFY_TTL_MS) return;
  // Stamp before the write: a throw must not turn every later request into
  // another attempt at the same failing statement.
  mirroredAt.set(user.id, now);
  db.prepare(
    `INSERT INTO users (id, email, role, username, display_name, avatar_url, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       role = excluded.role,
       username = COALESCE(excluded.username, users.username),
       display_name = COALESCE(excluded.display_name, users.display_name),
       avatar_url = excluded.avatar_url,
       synced_at = excluded.synced_at`
  ).run(
    user.id,
    user.email,
    user.role,
    user.username ?? null,
    user.displayName ?? null,
    user.avatarUrl ?? null
  );
}

/**
 * Read the current session from the request cookies. Works in server components
 * and route handlers alike (Node runtime, not edge).
 */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const user = await verifyToken(token);
  if (!user) return null;
  mirrorUser(user);
  return {
    sub: String(user.id),
    email: user.email,
    role: user.role,
    username: user.username ?? null,
    displayName: user.displayName ?? null,
    avatarUrl: user.avatarUrl ?? null,
    appearance: user.appearance,
  };
}

export function isAdmin(session: Session | null): boolean {
  return session?.role === "admin";
}
