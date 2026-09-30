import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  upgradeConfig,
  readStoredConfig,
  saveInstance,
  removeInstance,
  findProjectFile,
  resolveContext,
  resolveUrl,
  configPath,
  isAgentShell,
  useKeychain,
} from "./config.js";
import type { Keychain } from "./keychain.js";

const URL_A = "https://alpha.physalis.cloud";
const URL_B = "https://beta.physalis.cloud";

let root: string;

beforeEach(() => {
  useKeychain(null); // par défaut : pas de trousseau, tout dans le fichier
  root = mkdtempSync(join(tmpdir(), "physalis-cli-"));
  process.env.PHYSALIS_CONFIG_DIR = join(root, "home", ".physalis");
  for (const k of ["PHYSALIS_URL", "PHYSALIS_TOKEN", "PHYSALIS_PROJECT", "PHYSALIS_ENV", "CLAUDECODE", "PHYSALIS_AGENT"]) {
    delete process.env[k];
  }
  mkdirSync(join(root, "work"), { recursive: true });
  process.chdir(join(root, "work"));
});

test("upgradeConfig convertit la forme v1 à plat en instance", () => {
  const cfg = upgradeConfig({ url: `${URL_A}/`, token: "sv_abc", project: "p", env: "dev" });
  assert.equal(cfg.defaultUrl, URL_A);
  assert.deepEqual(cfg.instances[URL_A], { token: "sv_abc", kind: "machine", project: "p", env: "dev" });
});

test("upgradeConfig : une v1 sans token donne une config vide, un déchet aussi", () => {
  assert.deepEqual(upgradeConfig({ url: URL_A }).instances, {});
  assert.deepEqual(upgradeConfig("n'importe quoi").instances, {});
  assert.deepEqual(upgradeConfig(null).instances, {});
});

test("une v1 sur disque est lue comme une v2", () => {
  mkdirSync(process.env.PHYSALIS_CONFIG_DIR!, { recursive: true });
  writeFileSync(configPath(), JSON.stringify({ url: URL_A, token: "sv_cli_xyz" }));
  const cfg = readStoredConfig();
  assert.equal(cfg.version, 2);
  assert.equal(cfg.instances[URL_A]?.kind, "cli");
});

test("saveInstance range par URL, écrit en 0600 et fixe l'instance par défaut", () => {
  saveInstance(`${URL_A}/`, { token: "sv_cli_a", kind: "cli", expiresAt: 9e9 });
  saveInstance(URL_B, { token: "sv_cli_b", kind: "cli", expiresAt: 9e9 });
  const cfg = readStoredConfig();
  assert.equal(cfg.defaultUrl, URL_B);
  assert.deepEqual(Object.keys(cfg.instances).sort(), [URL_A, URL_B]);
  assert.equal(statSync(configPath()).mode & 0o777, 0o600);
});

test("removeInstance repli l'instance par défaut, puis supprime le fichier vide", () => {
  saveInstance(URL_A, { token: "sv_cli_a", kind: "cli" });
  saveInstance(URL_B, { token: "sv_cli_b", kind: "cli" });
  assert.equal(removeInstance(URL_B)?.token, "sv_cli_b");
  assert.equal(readStoredConfig().defaultUrl, URL_A);
  removeInstance(URL_A);
  assert.equal(existsSync(configPath()), false);
});

test("findProjectFile remonte les dossiers parents, comme git", () => {
  writeFileSync(join(root, "work", ".physalis.json"), JSON.stringify({ project: "p" }));
  const deep = join(root, "work", "src", "a", "b");
  mkdirSync(deep, { recursive: true });
  const found = findProjectFile(deep);
  assert.equal(found?.path, join(root, "work", ".physalis.json"));
  assert.equal(found?.config.project, "p");
});

test("findProjectFile : aucun fichier jusqu'à la racine → null ; JSON cassé → erreur", () => {
  assert.equal(findProjectFile(join(root, "work")), null);
  writeFileSync(join(root, "work", ".physalis.json"), "{ cassé");
  assert.throws(() => findProjectFile(join(root, "work")), /JSON valide/);
});

test("un seul login sert plusieurs projets : le .physalis.json choisit instance, projet et env", () => {
  saveInstance(URL_A, { token: "sv_cli_a", kind: "cli", expiresAt: 9e9 });
  saveInstance(URL_B, { token: "sv_cli_b", kind: "cli", expiresAt: 9e9 });
  writeFileSync(
    join(root, "work", ".physalis.json"),
    JSON.stringify({ url: URL_A, project: "site", env: "development" }),
  );
  mkdirSync(join(root, "work", "src"));
  process.chdir(join(root, "work", "src"));
  assert.deepEqual(resolveContext({}), {
    url: URL_A,
    token: "sv_cli_a",
    project: "site",
    env: "development",
  });
});

test("PHYSALIS_TOKEN prime sur la session stockée (cas CI)", () => {
  saveInstance(URL_A, { token: "sv_cli_a", kind: "cli", expiresAt: 9e9 });
  process.env.PHYSALIS_TOKEN = "sv_machine";
  const ctx = resolveContext({ project: "p", env: "e" });
  assert.equal(ctx.token, "sv_machine");
});

test("une session CLI expirée est refusée avec un message qui dit quoi faire", () => {
  saveInstance(URL_A, { token: "sv_cli_a", kind: "cli", expiresAt: 1000 });
  assert.throws(() => resolveContext({ project: "p", env: "e" }, 1_000_000), /Session expirée.*physalis login/);
});

test("un token machine n'expire pas côté CLI", () => {
  saveInstance(URL_A, { token: "sv_abc", kind: "machine" });
  assert.equal(resolveContext({ project: "p", env: "e" }, 9e15).token, "sv_abc");
});

test("contexte incomplet : l'erreur liste ce qui manque", () => {
  assert.throws(() => resolveContext({}), (err: Error) => {
    assert.match(err.message, /url/);
    assert.match(err.message, /accès/);
    assert.match(err.message, /project/);
    return true;
  });
});

test("resolveUrl : --url > PHYSALIS_URL > .physalis.json > défaut stocké", () => {
  saveInstance(URL_B, { token: "t", kind: "cli" });
  assert.equal(resolveUrl({}), URL_B);
  writeFileSync(join(root, "work", ".physalis.json"), JSON.stringify({ url: `${URL_A}/` }));
  assert.equal(resolveUrl({}), URL_A);
  process.env.PHYSALIS_URL = "https://env.physalis.cloud";
  assert.equal(resolveUrl({}), "https://env.physalis.cloud");
  assert.equal(resolveUrl({ url: "https://flag.physalis.cloud/" }), "https://flag.physalis.cloud");
});

test("le fichier de config ne contient que ce qu'on y a mis", () => {
  saveInstance(URL_A, { token: "sv_cli_a", kind: "cli", expiresAt: 42, email: "a@b.c" });
  const raw = JSON.parse(readFileSync(configPath(), "utf8"));
  assert.deepEqual(raw, {
    version: 2,
    defaultUrl: URL_A,
    instances: { [URL_A]: { token: "sv_cli_a", kind: "cli", expiresAt: 42, email: "a@b.c" } },
  });
});

test("shell d'agent : CLAUDECODE=1 ou PHYSALIS_AGENT=1", () => {
  assert.equal(isAgentShell({}), false);
  assert.equal(isAgentShell({ CLAUDECODE: "1" }), true);
  assert.equal(isAgentShell({ PHYSALIS_AGENT: "1" }), true);
  assert.equal(isAgentShell({ CLAUDECODE: "0" }), false);
});

test("dans le shell d'un agent, la session humaine n'est JAMAIS utilisée", () => {
  saveInstance(URL_A, { token: "sv_cli_humain", kind: "cli", expiresAt: 9e9 });
  process.env.CLAUDECODE = "1";
  assert.throws(
    () => resolveContext({ project: "p", env: "development" }),
    /Aucune session agent IA.*physalis login --ai/,
  );
  saveInstance(URL_A, { token: "sv_cli_agent", kind: "cli", expiresAt: 9e9 }, { ai: true });
  assert.equal(resolveContext({ project: "p", env: "development" }).token, "sv_cli_agent");
  delete process.env.CLAUDECODE;
  assert.equal(resolveContext({ project: "p", env: "development" }).token, "sv_cli_humain");
});

test("les sessions IA survivent à la relecture et se retirent à part", () => {
  saveInstance(URL_A, { token: "sv_cli_humain", kind: "cli" });
  saveInstance(URL_A, { token: "sv_cli_agent", kind: "cli" }, { ai: true });
  assert.equal(readStoredConfig().aiInstances?.[URL_A]?.token, "sv_cli_agent");
  assert.equal(removeInstance(URL_A, { ai: true })?.token, "sv_cli_agent");
  const cfg = readStoredConfig();
  assert.equal(cfg.instances[URL_A]?.token, "sv_cli_humain");
  assert.equal(cfg.aiInstances?.[URL_A], undefined);
});

/** Trousseau en mémoire ; `failing` simule un Secret Service qui refuse. */
function memoryKeychain(failing = false): Keychain & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    name: "mémoire",
    data,
    get: (a) => data.get(a) ?? null,
    set: (a, v) => {
      if (failing) return false;
      data.set(a, v);
      return true;
    },
    delete: (a) => {
      data.delete(a);
    },
  };
}

test("trousseau : la session humaine n'est plus dans le fichier, seulement sa référence", () => {
  const kc = memoryKeychain();
  useKeychain(kc);
  assert.equal(saveInstance(URL_A, { token: "sv_cli_humain", kind: "cli", expiresAt: 9e9 }), "keychain");
  const raw = readFileSync(configPath(), "utf8");
  assert.equal(raw.includes("sv_cli_humain"), false);
  assert.equal(readStoredConfig().instances[URL_A]?.store, "keychain");
  assert.equal(kc.data.get(`human:${URL_A}`), "sv_cli_humain");
  assert.equal(resolveContext({ project: "p", env: "e" }).token, "sv_cli_humain");
});

test("trousseau : la session IA reste dans le fichier (l'agent doit la lire)", () => {
  const kc = memoryKeychain();
  useKeychain(kc);
  assert.equal(saveInstance(URL_A, { token: "sv_cli_agent", kind: "cli" }, { ai: true }), "file");
  assert.equal(kc.data.size, 0);
  assert.equal(readStoredConfig().aiInstances?.[URL_A]?.token, "sv_cli_agent");
});

test("trousseau : un agent ne trouve la session humaine ni dans le fichier ni via la CLI", () => {
  useKeychain(memoryKeychain());
  saveInstance(URL_A, { token: "sv_cli_humain", kind: "cli", expiresAt: 9e9 });
  process.env.CLAUDECODE = "1";
  assert.throws(() => resolveContext({ project: "p", env: "e" }), /Aucune session agent IA/);
  delete process.env.CLAUDECODE;
});

test("trousseau : logout relit le jeton (pour révoquer) puis l'efface", () => {
  const kc = memoryKeychain();
  useKeychain(kc);
  saveInstance(URL_A, { token: "sv_cli_humain", kind: "cli" });
  assert.equal(removeInstance(URL_A)?.token, "sv_cli_humain");
  assert.equal(kc.data.size, 0);
});

test("trousseau vidé entre-temps : message clair, pas un 401 opaque", () => {
  const kc = memoryKeychain();
  useKeychain(kc);
  saveInstance(URL_A, { token: "sv_cli_humain", kind: "cli", expiresAt: 9e9 });
  kc.data.clear();
  assert.throws(() => resolveContext({ project: "p", env: "e" }), /introuvable dans le trousseau.*physalis login/);
});

test("trousseau qui refuse l'écriture : repli sur le fichier, et c'est dit", () => {
  useKeychain(memoryKeychain(true));
  assert.equal(saveInstance(URL_A, { token: "sv_cli_humain", kind: "cli" }), "file");
  assert.equal(readStoredConfig().instances[URL_A]?.token, "sv_cli_humain");
});
