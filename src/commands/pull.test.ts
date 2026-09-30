import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isPullableEnvironment, pullTarget, gitIgnoreStatus } from "./pull.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "physalis-pull-"));
});

function gitRepo(dir: string): void {
  execFileSync("git", ["init", "-q"], { cwd: dir });
}

test("seuls les environnements de dev sont téléchargeables (même liste que l'instance)", () => {
  for (const ok of ["development", "dev", "local", "test", "testing", "sandbox", " Dev "]) {
    assert.equal(isPullableEnvironment(ok), true, ok);
  }
  for (const ko of ["production", "prod", "main", "live", "staging", "dev-prod", ""]) {
    assert.equal(isPullableEnvironment(ko), false, ko);
  }
});

test("la cible par défaut est le .env à la racine du projet, même depuis un sous-dossier", () => {
  writeFileSync(join(root, ".physalis.json"), "{}");
  const deep = join(root, "src", "lib");
  mkdirSync(deep, { recursive: true });
  assert.equal(pullTarget(undefined, deep), join(root, ".env"));
});

test("--output relatif part du dossier courant, absolu est pris tel quel", () => {
  assert.equal(pullTarget("config/.env.local", root), join(root, "config", ".env.local"));
  assert.equal(pullTarget("/tmp/x.env", root), "/tmp/x.env");
});

test("sans .physalis.json, la cible est le .env du dossier courant", () => {
  assert.equal(pullTarget(undefined, root), join(root, ".env"));
});

test("git : un .env ignoré est accepté, un .env suivi serait committé", () => {
  gitRepo(root);
  const file = join(root, ".env");
  assert.equal(gitIgnoreStatus(file), "not_ignored");
  writeFileSync(join(root, ".gitignore"), ".env\n");
  assert.equal(gitIgnoreStatus(file), "ignored");
});

test("git : la règle d'un .gitignore parent s'applique à un sous-dossier", () => {
  gitRepo(root);
  writeFileSync(join(root, ".gitignore"), ".env*\n");
  mkdirSync(join(root, "app"));
  assert.equal(gitIgnoreStatus(join(root, "app", ".env.local")), "ignored");
});

test("hors dépôt git : signalé comme tel, pas comme ignoré", () => {
  assert.equal(gitIgnoreStatus(join(root, ".env")), "no_repo");
});

test("git absent : signalé, pour que pull refuse plutôt que de supposer", () => {
  const missing = (() => ({ error: new Error("ENOENT"), status: null })) as unknown as typeof import("node:child_process").spawnSync;
  assert.equal(gitIgnoreStatus(join(root, ".env"), missing), "no_git");
});
