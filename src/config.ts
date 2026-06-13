// Stockage du token + résolution du contexte (url, token, project, env).
//
// Modèle de menace (cf. cli-sdk.md §5) : le token est au repos dans
// ~/.physalis/config.json en 0600 (chiffré par le FS uniquement). Un token
// volé = lecture des secrets scopés → TTL court + révocation depuis l'UI.
// Override CI/non-interactif via la variable d'env PHYSALIS_TOKEN.

import { homedir } from "node:os";
import { join } from "node:path";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";

export type StoredConfig = {
  url?: string;
  token?: string;
  project?: string;
  env?: string;
};

export type Context = {
  url: string;
  token: string;
  project: string;
  env: string;
};

const CONFIG_DIR = join(homedir(), ".physalis");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const PROJECT_FILE = ".physalis.json"; // dans le cwd (à la doppler.yaml)

export function readStoredConfig(): StoredConfig {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as StoredConfig;
  } catch {
    return {};
  }
}

export function writeStoredConfig(cfg: StoredConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  // 0600 : lisible par le seul propriétaire.
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
}

export function clearStoredConfig(): void {
  if (existsSync(CONFIG_FILE)) rmSync(CONFIG_FILE);
}

export function configPath(): string {
  return CONFIG_FILE;
}

function readProjectFile(): StoredConfig {
  if (!existsSync(PROJECT_FILE)) return {};
  try {
    return JSON.parse(readFileSync(PROJECT_FILE, "utf8")) as StoredConfig;
  } catch {
    return {};
  }
}

export type Flags = {
  url?: string;
  token?: string;
  project?: string;
  env?: string;
};

/**
 * Résout le contexte effectif. Priorité (du plus fort au plus faible) :
 *   flags CLI  →  variables d'env  →  .physalis.json (cwd)  →  config stockée.
 * Le token suit la même chaîne, mais PHYSALIS_TOKEN prime (cas CI).
 * Lève une erreur lisible si un champ requis manque.
 */
export function resolveContext(flags: Flags): Context {
  const stored = readStoredConfig();
  const projectFile = readProjectFile();
  const env = process.env;

  const url =
    flags.url ?? env.PHYSALIS_URL ?? projectFile.url ?? stored.url;
  const token =
    flags.token ?? env.PHYSALIS_TOKEN ?? projectFile.token ?? stored.token;
  const project =
    flags.project ?? env.PHYSALIS_PROJECT ?? projectFile.project ?? stored.project;
  const envName =
    flags.env ?? env.PHYSALIS_ENV ?? projectFile.env ?? stored.env;

  const missing: string[] = [];
  if (!url) missing.push("url (PHYSALIS_URL ou `physalis login`)");
  if (!token) missing.push("token (PHYSALIS_TOKEN ou `physalis login`)");
  if (!project) missing.push("project (--project/-p, PHYSALIS_PROJECT ou .physalis.json)");
  if (!envName) missing.push("env (--env/-e, PHYSALIS_ENV ou .physalis.json)");
  if (missing.length) {
    throw new Error(`Contexte incomplet — manque :\n  - ${missing.join("\n  - ")}`);
  }

  return {
    url: url!.replace(/\/$/, ""),
    token: token!,
    project: project!,
    env: envName!,
  };
}
