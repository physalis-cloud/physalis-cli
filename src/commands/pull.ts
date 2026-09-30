// `physalis pull` — écrit le `.env` d'un environnement de DEV pour travailler
// hors ligne (chantier agent-ssh, phase 2c, scénario S1).
//
// C'est la seule commande qui écrit des secrets EN CLAIR sur le disque, donc
// elle refuse tout ce qui rendrait ce fichier dangereux :
//   - un environnement qui n'est pas de dev (liste fermée, la même que côté
//     instance : lib/cli-secrets.ts) — l'instance le refuse aussi ;
//   - un fichier que git ne ignore PAS (il finirait committé) ;
// et l'écrit en 0600, lisible par l'utilisateur seul.

import { spawnSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { findProjectFile, resolveContext, type Flags } from "../config.js";
import { fetchSecrets } from "../client.js";
import { toEnvLine } from "./export.js";

/** Même liste que l'instance (lib/cli-secrets.ts, PULLABLE_ENV_NAMES). */
export const PULLABLE_ENV_NAMES: ReadonlySet<string> = new Set([
  "development",
  "dev",
  "local",
  "test",
  "testing",
  "sandbox",
]);

export function isPullableEnvironment(name: string): boolean {
  return PULLABLE_ENV_NAMES.has(name.trim().toLowerCase());
}

/** Le fichier visé : `--output`, sinon `.env` à la racine du projet (dossier du .physalis.json). */
export function pullTarget(output: string | undefined, cwd: string = process.cwd()): string {
  if (output) return isAbsolute(output) ? output : join(cwd, output);
  const projectFile = findProjectFile(cwd);
  return join(projectFile ? dirname(projectFile.path) : cwd, ".env");
}

export type GitIgnoreStatus = "ignored" | "not_ignored" | "no_repo" | "no_git";

/** `git check-ignore` : 0 = ignoré, 1 = pas ignoré, 128 = hors dépôt. */
export function gitIgnoreStatus(
  file: string,
  run: typeof spawnSync = spawnSync,
): GitIgnoreStatus {
  const dir = dirname(file);
  const res = run("git", ["check-ignore", "-q", "--", relative(dir, file) || file], {
    cwd: dir,
    stdio: "ignore",
  });
  if (res.error) return "no_git";
  if (res.status === 0) return "ignored";
  if (res.status === 1) return "not_ignored";
  return "no_repo";
}

export async function pullCommand(flags: Flags & { output?: string }): Promise<number> {
  const ctx = resolveContext(flags);

  if (!isPullableEnvironment(ctx.env)) {
    process.stderr.write(
      `Refusé : « ${ctx.env} » n'est pas un environnement de développement ` +
        `(${[...PULLABLE_ENV_NAMES].join(", ")}). Utilise \`physalis run\`.\n`,
    );
    return 2;
  }

  const target = pullTarget(flags.output);
  const ignore = gitIgnoreStatus(target);
  if (ignore === "not_ignored") {
    process.stderr.write(
      `Refusé : ${target} n'est pas ignoré par git, il finirait committé.\n` +
        "Ajoute-le à .gitignore, puis relance `physalis pull`.\n",
    );
    return 2;
  }
  if (ignore === "no_git") {
    process.stderr.write(
      "Refusé : git est introuvable, impossible de vérifier que le fichier est ignoré.\n",
    );
    return 2;
  }

  const secrets = await fetchSecrets(ctx, { purpose: "pull" });
  const keys = Object.keys(secrets).sort();
  const content = keys.map((k) => toEnvLine(k, secrets[k]!)).join("\n") + (keys.length ? "\n" : "");

  writeFileSync(target, content, { mode: 0o600 });
  // `mode` ne s'applique qu'à la CRÉATION : un .env existant garderait ses droits.
  chmodSync(target, 0o600);

  process.stderr.write(
    `✓ ${keys.length} variable(s) de ${ctx.project}/${ctx.env} écrites dans ${target} (0600).\n` +
      "  Fichier EN CLAIR : supprime-le dès que tu n'en as plus besoin" +
      (ignore === "no_repo" ? " (hors dépôt git : aucune vérification .gitignore)" : "") +
      ".\n",
  );
  return 0;
}
