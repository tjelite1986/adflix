# adflix — Claude Code Instructions

## Working rules (every session, local or cloud)

- **Language:** everything written to a file is English: code comments, UI
  strings, API error messages, log output, README, JSON descriptions, commit
  messages. Chat with the owner in Swedish. No emojis unless asked.
- **`docs/` is local-only.** It is a scratch area between the owner and Claude,
  gitignored on purpose. Never commit it and never `git add -f` it. A cloud
  session will not see it; ask the owner to paste what you need.
- **No secrets in git:** `.env`, `.env.*`, dated backups like `.env.bak-*`,
  keys and tokens. Read `git status` before every commit.
- **Target platform:** the owner self-hosts on a Raspberry Pi (linux/arm64,
  Node 20) and an x86 Linux box, as Docker images behind Traefik. Code must
  build and run on linux/arm64 with Node 20. Check that any new native
  dependency ships arm64 builds.
- **Cloud sessions cannot reach production:** no host, no live database, no
  `.env`, no container logs. Deliver work as a branch and a PR whose
  description says how to verify it live. Deploy and live verification are
  done by the owner on the host. Do not claim something works in production.
- **Data safety:** never blanket-`DELETE` or `rm` a database or data directory
  to clean up after a test; remove only what the test created.
- **Keep diffs about the change:** do not reformat code you are not otherwise
  touching. Run `prettier --check` before `prettier --write` on an older file.
- **Archive, don't delete:** don't delete branches; tag them `archive/<name>`
  first.

## Lessons learned

### Origin of this repo
- adflix was split out of a larger parent app (elite-v2): the shell (SSO, middleware, in-app job scheduler, custom `server.mjs`) and the 18+ video code came over by copy. Both apps still run, each with its own copy of the library and DB; the only runtime link is SSO token verification against the parent. Do not add new calls into the parent app.
- A string URL in client code is not an import: no tool checks that `"/api/x"` has an `app/api/x/route.ts`. After moving or adding components, grep every `/api/...` string under `components/ app/ lib/` and confirm each first segment exists under `app/api/`. A missing image route fails silently (an `<img>` 404 logs nothing; tsc, lint and CI stay green). Known case: `components/performer-tpdb-scenes.tsx` points at `/api/image-proxy`, which does not exist in this repo — port a hardened proxy (SSRF guard, pinned IP, raster only) or change the source.
- Before removing or moving a storage root constant, grep the constant (not the path) and list every caller; storage roots collect more than one feature's files.
- `VIDEO_CHANNELS = ["adults"]` but the `VideoChannel` type keeps `"main"` on purpose: shared code paths were kept intact. Do not "clean up" the type without following every `channel !== "adults"` branch.
- No PIN gate by design: sign-in is the gate. Every media route (`stream`, `poster`, performer image) must re-check the session and `canAccessVideoChannel()` itself — the media URL is what leaks when only the page is gated.

### SQLite and `next build`
- `lib/db.ts` exports a lazy `Proxy`, never an open connection at module top level. `next build` imports every route module in parallel workers; a top-level open runs the schema setup once per worker against a fresh file and loses the lock race (`database is locked` / "Failed to collect page data"). Keep it lazy and keep routes `force-dynamic` so nothing queries at build time.
- `busy_timeout` must be the FIRST pragma after `new Database(...)`, before `journal_mode = WAL` (the WAL switch takes a write lock). Applies to every opener, including `lib/jobs-runtime.mjs` and `scripts/*.mjs` — `scripts/enable-jobs.mjs` currently opens without one.
- Transactions that read before they write must use `.immediate()`: a deferred `BEGIN` upgrading a read lock returns SQLITE_BUSY at once and never consults `busy_timeout`.
- SQLite has no `ADD COLUMN IF NOT EXISTS`. A `PRAGMA table_info` check is not atomic across build workers; wrap any `ALTER TABLE ... ADD COLUMN` so "duplicate column name" counts as already applied and everything else still throws.
- Never write a backfill whose WHERE tests the column being backfilled — it re-runs on every boot and overwrites the user's choice. Key it on the ALTER actually adding the column, or a marker row.
- `datetime('now')` is UTC (`job_schedules.next_run_at`, `last_run_at`, etc.). Compare against UTC, not local wall-clock time, or a healthy scheduler looks two hours late.
- Delete files only after the DB delete has committed. An orphan file is repairable by maintenance; a row pointing at a deleted file is not.

### Instrumentation and the build
- `instrumentation.ts` must import `lib/db` dynamically INSIDE the literal `if (process.env.NEXT_RUNTIME === "nodejs") { ... }` block. An early `return` for other runtimes leaves better-sqlite3's `fs`/`path` imports in the edge bundle and `next build` fails, while tsc and lint stay green.
- tsc + lint are not build proof for anything touching instrumentation, `next.config.mjs` or middleware imports — run `next build` (or let the CI image job build) before calling it done.
- The image ships full production `node_modules` (no `output: "standalone"`) because of the custom server and `docker exec`-run scripts. Before keeping or changing that, check what `scripts/*.mjs` actually import: if they only need deps the app already imports, standalone would trace them. A script that imports from `lib/` must be self-contained instead.

### Library scan and metadata
- The scan mirrors the disk: rows whose file is gone are deleted. Keep the "whole root reads empty = unmounted volume, keep rows" guard and the in-flight-conversion skip in `scanVideoChannel()`; without them one failed mount wipes the library.
- Jobs are seeded disabled (`enabled INTEGER NOT NULL DEFAULT 0`) and the admin's saved enabled/interval must survive restarts. Do not seed them on.
- AI summaries are opt-in: nothing is sent to a vision API unless `VIDEO_AI_SUMMARY_CHANNELS` names the channel. An API key alone must never enable it.
- Dated scene releases (`Studio.YY.MM.DD.Performer`) are matched via TPDB's `?parse=` lookup first (`findParseMatches` / `isConfidentParse` in `lib/tpdb.ts`, called from `candidatesFor`). Auto-save only when TPDB's date equals the file's date AND runtime differs by at most ~2 %. Without a date in the name, `parse` returns junk — fall back to the title search.
- A `.mp4` name or a `video/mp4` MIME is a claim: a login wall or error page arrives as HTTP 200 HTML. Sniff leading bytes (ISO-BMFF box family `ftyp moov mdat free skip wide`, EBML, RIFF) before storing anything downloaded; a size floor is not a content check.

### Routes and security
- `middleware.ts` CSRF check covers non-GET only (the session cookie is parent-domain scoped, so `SameSite=lax` gives no protection between sibling subdomains). Any GET that changes state is outside that net — keep GETs side-effect free, or give the route its own `Sec-Fetch-Site: same-origin` / Referer-host check.
- File routes: validate each path segment as a single name (no `/`, `\`, `.`, `..`) before joining, and check the resolved path stays under the specific directory, not just the library root. Next decodes `%2F` inside one segment.
- An `<img>`, `<video>` or stylesheet sends cookies only, never custom headers. A media endpoint reachable from a tag must authenticate by cookie; never put a token in a query string.
- CSP allows only `'self'`, `data:` and `blob:` for media/images. Remote poster/performer URLs must go through an own route, not straight into `src`.
- `Readable.toWeb(fs.createReadStream(...))` (used in `app/api/videos/[id]/stream/route.ts`) throws an uncatchable `ERR_INVALID_STATE` "Controller is already closed" whenever the client aborts — every seek and every scroll-away. Prefer a hand-pumped `ReadableStream` that catches `enqueue()`, destroys the file stream on cancel/`request.signal`, and pauses on `desiredSize <= 0`.

### Client UI
- Server components may not pass function props to client components (the page hangs in its loading state; the error is only in the server log). Pass data and a discriminator.
- `"use client"` is file-wide: adding state to one export in a shared module turns every helper and class constant in it into a client reference. Split the stateful part into its own file.
- Infinite-scroll observers: the effect in `components/videos-browser.tsx` rebuilds the observer when `loadingMore` flips, so a failing fetch (500/offline) re-fires immediately in a hot loop. Add backoff or an error state the callback checks. Also: an observer only fires on transitions — any state its early-return reads must be an effect dependency, or the initial delivery is consumed and never repeated.
- `play()` rejects with `AbortError` on every pause-interrupted start and `NotSupportedError` for a missing codec; only `NotAllowedError` means autoplay was blocked. Don't treat every rejection as a failure or as a user choice.
- For video in a full-screen overlay use `h-full w-full object-contain`; `max-h-full max-w-full` never upscales, so low-res files render as a small box. `max-*` is right for photos.
- Headless Playwright Chromium has no H.264: a video that won't play there is the test rig. Verify playback with WebM/VP8.
