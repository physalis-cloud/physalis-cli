// Parcours principal : se connecter par le navigateur, lancer sa commande avec
// les secrets injectés, se déconnecter.
//   login (flux d'appareil) → whoami → run → run --mask → logout → run refusé

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { startFakeInstance, makeWorkspace, runCli, type FakeInstance, type Workspace } from "./helpers.ts";

const SESSION = "sv_cli_e2e_0123456789abcdef";
const API_KEY = "sk_live_e2e_9f8e7d6c5b4a";

let instance: FakeInstance;
let ws: Workspace;

before(async () => {
  instance = await startFakeInstance({
    tokens: [SESSION],
    secrets: { "demo/dev": { API_KEY } },
    deviceToken: SESSION,
    email: "dev@exemple.fr",
  });
  ws = makeWorkspace();
  mkdirSync(ws.dir, { recursive: true });
});

after(async () => {
  await instance.close();
  ws.dispose();
});

test("login ouvre une session CLI une fois le code approuvé", async () => {
  const res = await runCli(ws, ["login", "--url", instance.url, "--no-browser", "-p", "demo", "-e", "dev"]);
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stderr, /ABCD-EFGH/);
  assert.match(res.stderr, /Connecté à .* en tant que dev@exemple\.fr/);
  assert.ok(instance.requests.some((r) => r.path === "/api/cli/device/start"));
});

test("whoami décrit la session et le contexte", async () => {
  const res = await runCli(ws, ["whoami"]);
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /session CLI de dev@exemple\.fr/);
  assert.match(res.stdout, /^project +: demo$/m);
  assert.match(res.stdout, /^env +: dev$/m);
  assert.ok(!res.stdout.includes(SESSION), "le jeton ne s'affiche pas en entier");
});

test("run injecte les secrets dans la commande et propage son code de sortie", async () => {
  const check = `process.exit(process.env.API_KEY === ${JSON.stringify(API_KEY)} ? 7 : 1)`;
  const res = await runCli(ws, ["run", "--", process.execPath, "-e", check]);
  assert.equal(res.code, 7, res.stderr);
  const call = instance.requests.find((r) => r.path === "/api/secrets/demo/dev");
  assert.equal(call?.authorization, `Bearer ${SESSION}`);
});

test("run --mask remplace les valeurs des secrets dans la sortie", async () => {
  const res = await runCli(ws, ["run", "--mask", "--", process.execPath, "-e", "console.log('clé=' + process.env.API_KEY)"]);
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /^clé=/);
  assert.ok(!res.stdout.includes(API_KEY), `secret visible : ${res.stdout}`);
});

test("logout révoque la session côté instance", async () => {
  const res = await runCli(ws, ["logout"]);
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stderr, /Session révoquée/);
  const revoke = instance.requests.find((r) => r.method === "DELETE" && r.path === "/api/cli/session");
  assert.equal(revoke?.authorization, `Bearer ${SESSION}`);
});

test("après logout, run refuse et ne lance pas la commande", async () => {
  const res = await runCli(ws, ["run", "--url", instance.url, "-p", "demo", "-e", "dev", "--", process.execPath, "-e", "process.exit(7)"]);
  assert.equal(res.code, 1);
  assert.match(res.stderr, /Contexte incomplet/);
});
