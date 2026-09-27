import { createServer } from "node:http";
import next from "next";
import { startScheduler } from "./lib/jobs-runtime.mjs";

const port = Number(process.env.PORT) || 3000;
const hostname = process.env.HOSTNAME || "0.0.0.0";

// A custom server for one reason: the background-job scheduler has to live in
// the same long-running process as Next, and `next start` offers no hook for
// that.
const app = next({ dev: false, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

const server = createServer((req, res) => handle(req, res));

server.listen(port, hostname, () => {
  console.log(`> Ready on http://${hostname}:${port} (custom server)`);
  // Start the scheduler once the server is accepting requests: the
  // http-triggered jobs loop back to it.
  startScheduler();
});
