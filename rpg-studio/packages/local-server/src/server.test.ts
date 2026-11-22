import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../cli/src/build";
import { startServer, type RunningServer } from "./server";

let dir: string;
let running: RunningServer;
const port = 47000 + Math.floor(Math.random() * 2000);
const token = "test-token";

function request(method: string, url: string, options: { headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:${port}${url}`, { method, headers: { host: `127.0.0.1:${port}`, ...options.headers } }, res => {
      const chunks: Buffer[] = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}
const api = { "x-rpg-studio-token": token };
const write = { ...api, origin: `http://127.0.0.1:${port}`, "content-type": "application/json" };
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "rpg-server-"));
  await fs.cp(path.join(REPO_ROOT, "projects/sample-rpg"), dir, { recursive: true });
  running = await startServer({ projectDir: dir, port, token, watch: false, buildOnStart: false, uiDir: path.join(dir, "no-ui"), historyDir: `${dir}-history` });
});
afterAll(async () => {
  await running.close();
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(`${dir}-history`, { recursive: true, force: true });
});

describe("local server security", () => {
  it("rejects unknown Host, foreign Origin and missing token", async () => {
    expect((await request("GET", "/api/project", { headers: { ...api, host: "evil.example:80" } })).status).toBe(403);
    expect((await request("GET", "/api/project", { headers: { ...api, origin: "http://evil.example" } })).status).toBe(403);
    expect((await request("GET", "/api/project")).status).toBe(401);
    expect((await request("GET", "/api/project", { headers: api })).status).toBe(200);
  });

  it("never sends CORS headers", async () => {
    const res = await new Promise<http.IncomingMessage>(resolve => http.get(`http://127.0.0.1:${port}/api/project`, { headers: { ...api, host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` } }, resolve));
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    res.resume();
  });

  it("rejects traversal, absolute paths, hidden files and symlinks", async () => {
    for (const bad of ["../package.json", "/etc/passwd", "maps/../../x.png", "maps\\village.json", ".git/config.json"]) {
      const res = await request("GET", `/api/asset?path=${encodeURIComponent(bad)}`, { headers: api });
      expect([400, 415]).toContain(res.status);
    }
    // A directory junction (Windows: needs no privilege; elsewhere a directory symlink).
    await fs.symlink(path.join(dir, "assets/tilesets"), path.join(dir, "assets/linked"), "junction");
    expect((await request("GET", "/api/asset?path=assets/linked/sample-village.png", { headers: api })).status).toBe(403);
    // A file symlink. Windows refuses to create one without admin rights / developer mode: then only the junction is checked.
    const fileLink = await fs.symlink(path.join(dir, "assets/tilesets/sample-village.png"), path.join(dir, "assets/link.png")).then(() => true, (error: NodeJS.ErrnoException) => {
      if (process.platform === "win32" && error.code === "EPERM") return false;
      throw error;
    });
    if (fileLink) expect((await request("GET", "/api/asset?path=assets/link.png", { headers: api })).status).toBe(403);
    expect((await request("GET", "/api/asset?path=assets/tilesets/sample-village.png", { headers: api })).status).toBe(200);
  });

  it("requires Origin for writes and refuses stale hashes with the latest content", async () => {
    const snapshot = JSON.parse((await request("GET", "/api/project", { headers: api })).body);
    const original = snapshot.texts["events/events.json"] as string;
    const changed = original.replace("立て札", "古い立て札");
    const body = JSON.stringify({ path: "events/events.json", content: changed, expectedHash: snapshot.hashes["events/events.json"] });
    expect((await request("PUT", "/api/file", { headers: { ...api, "content-type": "application/json" }, body })).status).toBe(403);
    const ok = await request("PUT", "/api/file", { headers: write, body });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body).hash).toBe(sha(changed));
    expect(await fs.readFile(path.join(dir, "events/events.json"), "utf8")).toBe(changed);
    // Same (now stale) hash again → conflict, and the file on disk is untouched.
    const stale = await request("PUT", "/api/file", { headers: write, body: JSON.stringify({ path: "events/events.json", content: original, expectedHash: snapshot.hashes["events/events.json"] }) });
    expect(stale.status).toBe(409);
    expect(JSON.parse(stale.body)).toMatchObject({ error: "conflict", latestHash: sha(changed), latestContent: changed });
    expect(await fs.readFile(path.join(dir, "events/events.json"), "utf8")).toBe(changed);
  });

  it("refuses invalid JSON, binary writes and new files", async () => {
    const snapshot = JSON.parse((await request("GET", "/api/project", { headers: api })).body);
    expect((await request("PUT", "/api/file", { headers: write, body: JSON.stringify({ path: "tiles.json", content: "{", expectedHash: snapshot.hashes["tiles.json"] }) })).status).toBe(422);
    expect((await request("PUT", "/api/file", { headers: write, body: JSON.stringify({ path: "assets/x.png", content: "AAAA", expectedHash: "x" }) })).status).toBe(415);
    expect((await request("PUT", "/api/file", { headers: write, body: JSON.stringify({ path: "maps/new.json", content: "{}", expectedHash: "x" }) })).status).toBe(404);
  });

  it("creates new files only with an empty expected hash, inside existing folders, never over existing files", async () => {
    const created = await request("PUT", "/api/file", { headers: write, body: JSON.stringify({ path: "maps/brand-new.json", content: "{}", expectedHash: "" }) });
    expect(created.status).toBe(200);
    const again = await request("PUT", "/api/file", { headers: write, body: JSON.stringify({ path: "maps/brand-new.json", content: "{\"x\":1}", expectedHash: "" }) });
    expect(again.status).toBe(409);
    expect((await request("PUT", "/api/file", { headers: write, body: JSON.stringify({ path: "nowhere/new.json", content: "{}", expectedHash: "" }) })).status).toBe(400);
    expect((await request("PUT", "/api/file", { headers: write, body: JSON.stringify({ path: "IDEA.md", content: "# idea", expectedHash: "" }) })).status).toBe(200);
    // Scripts: scripts/<id>.ts can be created (the folder too), deeper paths cannot.
    const script = 'import { defineScript } from "@rpg/engine";\nexport default defineScript({});\n';
    expect((await request("PUT", "/api/file", { headers: write, body: JSON.stringify({ path: "scripts/brand-new.ts", content: script, expectedHash: "" }) })).status).toBe(200);
    expect((await request("PUT", "/api/file", { headers: write, body: JSON.stringify({ path: "scripts/deep/new.ts", content: script, expectedHash: "" }) })).status).toBe(400);
  });

  it("saves PNGs from the pixel editor only under assets/<folder>/, only real PNGs, with conflict detection", async () => {
    const png = await fs.readFile(path.join(dir, "assets/characters/elf-ranger.png"));
    const put = (body: unknown) => request("PUT", "/api/image", { headers: write, body: JSON.stringify(body) });
    const created = await put({ path: "assets/drawn/hero.png", base64: png.toString("base64"), expectedHash: "" });
    expect(created.status).toBe(200);
    expect((await fs.readFile(path.join(dir, "assets/drawn/hero.png"))).equals(png)).toBe(true);
    expect((await put({ path: "assets/drawn/hero.png", base64: png.toString("base64"), expectedHash: "" })).status).toBe(409);
    expect((await put({ path: "assets/drawn/hero.png", base64: png.toString("base64"), expectedHash: "stale" })).status).toBe(409);
    expect((await put({ path: "assets/drawn/hero.png", base64: png.toString("base64"), expectedHash: JSON.parse(created.body).hash })).status).toBe(200);
    expect((await put({ path: "maps/evil.png", base64: png.toString("base64"), expectedHash: "" })).status).toBe(400);
    expect((await put({ path: "assets/a/b/c.png", base64: png.toString("base64"), expectedHash: "" })).status).toBe(400);
    expect((await put({ path: "assets/drawn/fake.png", base64: Buffer.from("not a png at all, really").toString("base64"), expectedHash: "" })).status).toBe(422);
    expect((await request("PUT", "/api/image", { headers: api, body: JSON.stringify({ path: "assets/drawn/x.png", base64: png.toString("base64"), expectedHash: "" }) })).status).toBe(403);
  });

  it("lists the shared library, serves only catalogued images and copies chosen items into the project", async () => {
    const catalog = JSON.parse((await request("GET", "/api/library", { headers: api })).body) as { items: Array<{ id: string; path: string; kind: string }> };
    expect(catalog.items.length).toBeGreaterThan(50);
    const enemy = catalog.items.find(i => i.kind === "enemy")!;
    expect((await request("GET", `/api/library/image?path=${encodeURIComponent(enemy.path)}`, { headers: api })).status).toBe(200);
    expect((await request("GET", `/api/library/image?path=${encodeURIComponent("../package.json")}`, { headers: api })).status).toBe(404);
    expect((await request("POST", "/api/library/add", { headers: api, body: JSON.stringify({ ids: [enemy.id] }) })).status).toBe(403);
    expect((await request("POST", "/api/library/add", { headers: write, body: JSON.stringify({ ids: [enemy.id] }) })).status).toBe(200);
    const assets = JSON.parse(await fs.readFile(path.join(dir, "assets.json"), "utf8")) as { assets: Array<{ id: string }> };
    expect(assets.assets.some(a => a.id === enemy.id)).toBe(true);
  }, 30000);

  it("keeps a save history with plain-language summaries and restores an earlier version", async () => {
    const file = "database.json";
    const original = JSON.parse((await request("GET", "/api/project", { headers: api })).body).texts[file] as string;
    const db = JSON.parse(original);
    db.enemies[0].stats.maxHp += 5;
    db.enemies.push({ ...db.enemies[0], id: "history-test-foe", name: "履歴の敵" });
    const edited = `${JSON.stringify(db, null, 2)}\n`;
    expect((await request("PUT", "/api/file", { headers: write, body: JSON.stringify({ path: file, content: edited, expectedHash: sha(original) }) })).status).toBe(200);
    const list = JSON.parse((await request("GET", `/api/history?file=${file}`, { headers: api })).body).entries as Array<{ id: string; source: string; summary: string[] }>;
    expect(list[0]!.source).toBe("studio");
    expect(list[0]!.summary.join("\n")).toContain("history-test-foe（履歴の敵） を追加");
    expect(list[0]!.summary.join("\n")).toContain("stats.maxHp: 7 → 12");
    const restored = await request("POST", "/api/history/restore", { headers: write, body: JSON.stringify({ id: list[0]!.id, side: "before" }) });
    expect(restored.status).toBe(200);
    expect(await fs.readFile(path.join(dir, file), "utf8")).toBe(original);
    const after = JSON.parse((await request("GET", `/api/history?file=${file}`, { headers: api })).body).entries as Array<{ source: string }>;
    expect(after[0]!.source).toBe("restore");
    expect((await request("POST", "/api/history/restore", { headers: { ...api, "content-type": "application/json" }, body: "{}" })).status).toBe(403); // writes need Origin
   }, 30000);

  it("exposes no command execution endpoints", async () => {
    for (const route of ["/api/exec", "/api/run", "/api/shell"]) expect((await request("POST", route, { headers: write, body: "{}" })).status).toBe(404);
  });

  it("runs the project's scenario tests as a fixed operation", async () => {
    const res = await request("POST", "/api/test", { headers: write, body: "{}" });
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.results.length).toBeGreaterThanOrEqual(3);
  }, 60000);
});
