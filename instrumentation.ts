// Runs once when the server starts (never during `next build`). Opening the
// database here creates the schema on boot, so scripts/migrate-from-elitev2.mjs
// can run against a fresh install without first having to hit a page that
// happens to touch the database.
export async function register() {
  // The import must sit inside this literal check: webpack drops the branch from
  // the edge bundle only in this shape, and an early `return` instead leaves
  // better-sqlite3's fs/path imports in it and fails the build.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { db } = await import("./lib/db");
    db.prepare("SELECT 1").get();
  }
}
