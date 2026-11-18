import { mkdir, appendFile, stat, rename } from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";

const root = resolve(
  process.env.GOBLIN_LEDGER_HOME ||
    join(
      process.env.LOCALAPPDATA || join(homedir(), ".local", "share"),
      "GoblinLedger",
    ),
);
const configured = process.env.GOBLIN_LEDGER_PORT || "4774";
let app;
async function healthy(url) {
  try {
    const response = await fetch(url + "/api/v1/health", {
      signal: AbortSignal.timeout(1200),
    });
    const data = await response.json();
    return (
      response.ok && data.product === "Goblin Ledger" && data.protocol === 1
    );
  } catch {
    return false;
  }
}
try {
  if (!/^\d+$/.test(configured) || Number(configured) > 65535)
    throw Error("GOBLIN_LEDGER_PORT must be a port between 0 and 65535.");
  const port = Number(configured),
    url = "http://127.0.0.1:" + port;
  if (port && (await healthy(url))) {
    console.log("Goblin Ledger is already running. Open " + url);
  } else {
    const { createServer } = await import("./server.mjs");
    app = await createServer({
      root,
      scheduling: process.env.GOBLIN_LEDGER_DISABLE_SCHEDULE !== "1",
    });
    try {
      const address = await app.listen({ port, host: "127.0.0.1" });
      console.log("Goblin Ledger is ready. Open " + address);
      const stop = async () => {
        await app.close();
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      // An IPC parent (the release smoke) can request an orderly shutdown.
      if (process.send) {
        process.once("message", async (message) => {
          if (message === "shutdown") {
            await stop();
            process.disconnect();
          }
        });
        process.send({ address });
      }
    } catch (error) {
      await app.close();
      if (error.code === "EADDRINUSE" && (await healthy(url)))
        console.log("Goblin Ledger is already running. Open " + url);
      else throw error;
    }
  }
} catch (error) {
  const detail =
    error.code === "EADDRINUSE"
      ? "This port is in use by another service. Set GOBLIN_LEDGER_PORT to another port."
      : String(error.message)
          .replace(/(?:[A-Z]:[\\/]|\\\\)[^'\n]*/gi, "[local path]")
          .slice(0, 700);
  console.error("Goblin Ledger could not start. " + detail);
  try {
    const actual = await realpath(root).catch(() => root);
    const within = relative(
      await realpath(fileURLToPath(new URL("../../", import.meta.url))),
      actual,
    );
    if (!within || (!within.startsWith("..") && !isAbsolute(within)))
      throw Error("Data directory falls inside checkout.");
    await mkdir(root, { recursive: true });
    const log = join(root, "bootstrap.log");
    if ((await stat(log).catch(() => ({ size: 0 }))).size > 64000)
      await rename(log, log + ".previous").catch(() => {});
    await appendFile(log, new Date().toISOString() + " " + detail + "\n");
    console.error("Diagnostic: " + log);
  } catch {
    console.error("The diagnostic directory is unavailable.");
  }
  process.exitCode = 1;
}
