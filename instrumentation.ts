// Runs once when the server starts (never during `next build`). Opening the
// database here creates the schema on boot, so scripts/migrate-from-elitev2.mjs
// can run against a fresh install without first having to hit a page that
// happens to touch the database.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { db } = await import("./lib/db");
  db.prepare("SELECT 1").get();
}
