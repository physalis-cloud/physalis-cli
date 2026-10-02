// Parcours « travailler hors ligne » : écrire le .env d'un environnement de dev,
// et seulement dans les conditions où ce fichier ne fuit pas.
//   login --token → pull (dev, .env ignoré par git) → refus (prod, .env non ignoré)

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { startFakeInstance, makeWorkspace, runCli, type FakeInstance, type Workspace } from "./helpers.ts";

const TOKEN = "sv_machine_e2e_abcdef012345";

let instance: FakeInstance;
let ws: Workspace;

before(async () => {
  instance = await startFakeInstance({
    tokens: [TOKEN],
    secrets: {
      "demo/dev": { DATABASE_URL: "postgres://localhost/demo", API_KEY: "valeur avec espaces" },
      "demo/production": { API_KEY: "prod" },
    },
  });
  ws = makeWorkspace();
  mkdirSync(ws.dir, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: ws.dir });
  writeFileSync(join(ws.dir, ".gitignore"), ".env\n");
  writeFileSync(join(ws.dir, ".physalis.json"), JSON.stringify({ url: instance.url, project: "demo", env: "dev" }));
});

after(async () => {
  await instance.close();
  ws.dispose();
});

test("login --token enregistre un token machine", async () => {
  const res = await runCli(ws, ["login", "--token", TOKEN]);
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stderr, /enregistré pour/);
});

test("pull écrit le .env du projet en 0600", async () => {
  const res = await runCli(ws, ["pull"]);
  assert.equal(res.code, 0, res.stderr);
  const file = join(ws.dir, ".env");
  const content = readFileSync(file, "utf8");
  assert.match(content, /^API_KEY=/m);
  assert.match(content, /^DATABASE_URL=postgres:\/\/localhost\/demo$/m);
  if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.ok(instance.requests.some((r) => r.path === "/api/secrets/demo/dev?purpose=pull"));
});

test("pull refuse un environnement qui n'est pas de dev, sans appeler l'instance", async () => {
  const before = instance.requests.length;
  const res = await runCli(ws, ["pull", "-e", "production"]);
  assert.equal(res.code, 2);
  assert.match(res.stderr, /n'est pas un environnement de développement/);
  assert.equal(instance.requests.length, before);
});

test("pull refuse un .env que git n'ignore pas", async () => {
  rmSync(join(ws.dir, ".env"));
  writeFileSync(join(ws.dir, ".gitignore"), "");
  const res = await runCli(ws, ["pull"]);
  assert.equal(res.code, 2);
  assert.match(res.stderr, /n'est pas ignoré par git/);
});
