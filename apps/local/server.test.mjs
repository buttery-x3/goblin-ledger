import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "./server.mjs";

test("the real app guards cross-tab writes and persists independent workspaces", async () => {
  const root = await mkdtemp(join(tmpdir(), "Ledger isolated "));
  let app = await createServer({ root, scheduling: false });
  const base = { host: "127.0.0.1:4774" };
  const get = (url) => app.inject({ url: "/api/v1" + url, headers: base });
  const bootstrap = async () => {
    const r = await get("/bootstrap");
    assert.equal(r.statusCode, 200, r.body);
    return {
      data: r.json(),
      headers: {
        ...base,
        cookie: r.headers["set-cookie"].split(";")[0],
        "x-goblin-token": r.json().token,
        "x-goblin-profile": r.json().mode + ":" + (r.json().region ?? "-"),
      },
    };
  };
  const put = (url, headers, payload) =>
    app.inject({ method: "PUT", url: "/api/v1" + url, headers, payload });
  try {
    const live = await bootstrap();
    assert.equal(live.data.region, null);
    assert.equal(
      (
        await put(
          "/workspace",
          { ...live.headers, origin: "http://elsewhere.test" },
          { workspace: {} },
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (await put("/settings", live.headers, { mode: "demo", region: "us" }))
        .statusCode,
      200,
    );
    const demo = await bootstrap();
    assert.ok(demo.data.routes.length >= 3);
    assert.equal(
      (await put("/workspace", live.headers, { workspace: { wrong: true } }))
        .statusCode,
      409,
    );
    assert.equal(
      (
        await put("/workspace", demo.headers, {
          workspace: { version: 1, name: "Test" },
        })
      ).statusCode,
      200,
    );
    await app.close();
    app = await createServer({ root, scheduling: false });
    const again = await bootstrap();
    assert.equal(again.data.workspace.name, "Test");
    assert.equal(
      (await put("/settings", again.headers, { mode: "live" })).statusCode,
      200,
    );
    assert.equal((await bootstrap()).data.workspace, null);
    assert.equal(
      (
        await app.inject({
          url: "/api/v1/health",
          headers: { host: "external.test" },
        })
      ).statusCode,
      403,
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
});
