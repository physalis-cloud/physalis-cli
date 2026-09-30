// Stockage des accès + résolution du contexte (url, token, project, env).
//
// Deux sortes d'accès, rangées PAR INSTANCE (URL) dans ~/.physalis/config.json :
//   - "cli"     : session CLI liée à l'utilisateur (`sv_cli_…`), obtenue par
//                 `physalis login` (flux d'appareil), valable 12 h, donne accès à
//                 tous les projets de l'utilisateur sur cette instance.
//   - "machine" : token `sv_…` créé dans l'UI, lié à UN projet et UN environnement.
//                 Reste le cas de la CI (PHYSALIS_TOKEN) et de `login --token`.
// Un compte vit dans une instance (un sous-domaine) : travailler pour deux clients
// = deux sessions, et le `url` de `.physalis.json` choisit la bonne.
//
// Modèle de menace : le fichier est en 0600 (protégé par le FS uniquement). Un
// token volé = lecture des secrets de sa portée → durée courte (session CLI) et
// révocation depuis l'UI. Un `sv_` n'expire PAS : il ne se coupe que révoqué.

import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";

export type AccessKind = "cli" | "machine";

export type Instance = {
  token: string;
  kind: AccessKind;
  /** Expiration d'une session CLI, en secondes epoch. Absent pour un `sv_`. */
  expiresAt?: number;
  email?: string;
  project?: string;
  env?: string;
};

export type StoredConfig = {
  version: 2;
  defaultUrl?: string;
  instances: Record<string, Instance>;
  /** Sessions « agent IA » (phase 2d), rangées À PART des sessions humaines. */
  aiInstances?: Record<string, Instance>;
};

/**
 * Shell d'un agent IA : Claude Code pose `CLAUDECODE=1` dans les commandes
 * qu'il lance ; `PHYSALIS_AGENT=1` couvre les autres agents. La CLI n'y utilise
 * QUE la session IA, jamais celle de l'humain. Contournable (`unset`) : c'est un
 * garde-fou contre l'erreur, la barrière reste le périmètre côté instance.
 */
export function isAgentShell(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CLAUDECODE === "1" || env.PHYSALIS_AGENT === "1";
}

/** Forme v1 (≤ 0.1.2) : un seul token, à plat. Lue puis convertie. */
type LegacyConfig = {
  url?: string;
  token?: string;
  project?: string;
  env?: string;
};

export type ProjectFile = {
  url?: string;
  /** Toléré pour compatibilité ; déconseillé (le fichier finit souvent committé). */
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

export type Flags = {
  url?: string;
  token?: string;
  project?: string;
  env?: string;
};

const PROJECT_FILE = ".physalis.json"; // à la doppler.yaml, cherché en remontant
export const CLI_TOKEN_PREFIX = "sv_cli_";

/** PHYSALIS_CONFIG_DIR permet un profil séparé (et isole les tests). */
function configDir(): string {
  return process.env.PHYSALIS_CONFIG_DIR ?? join(homedir(), ".physalis");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

/** Une URL d'instance, sans slash final : c'est la clé de `instances`. */
export function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function kindOfToken(token: string): AccessKind {
  return token.startsWith(CLI_TOKEN_PREFIX) ? "cli" : "machine";
}

function emptyConfig(): StoredConfig {
  return { version: 2, instances: {} };
}

/** Convertit la forme v1 à plat. Un fichier illisible vaut une config vide. */
export function upgradeConfig(raw: unknown): StoredConfig {
  if (!raw || typeof raw !== "object") return emptyConfig();
  const obj = raw as Partial<StoredConfig> & LegacyConfig;
  if (obj.version === 2 && obj.instances && typeof obj.instances === "object") {
    return {
      version: 2,
      defaultUrl: obj.defaultUrl,
      instances: obj.instances,
      ...(obj.aiInstances && typeof obj.aiInstances === "object" ? { aiInstances: obj.aiInstances } : {}),
    };
  }
  const cfg = emptyConfig();
  if (obj.url && obj.token) {
    const url = normalizeUrl(obj.url);
    cfg.defaultUrl = url;
    cfg.instances[url] = {
      token: obj.token,
      kind: kindOfToken(obj.token),
      ...(obj.project ? { project: obj.project } : {}),
      ...(obj.env ? { env: obj.env } : {}),
    };
  }
  return cfg;
}

export function readStoredConfig(): StoredConfig {
  const file = configPath();
  if (!existsSync(file)) return emptyConfig();
  try {
    return upgradeConfig(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return emptyConfig();
  }
}

export function writeStoredConfig(cfg: StoredConfig): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  // 0600 : lisible par le seul propriétaire.
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
}

/** Enregistre (ou remplace) l'accès d'une instance et en fait l'instance par défaut. */
export function saveInstance(url: string, instance: Instance, opts: { ai?: boolean } = {}): void {
  const cfg = readStoredConfig();
  const key = normalizeUrl(url);
  if (opts.ai) {
    cfg.aiInstances = { ...(cfg.aiInstances ?? {}), [key]: instance };
  } else {
    cfg.instances[key] = instance;
  }
  cfg.defaultUrl = key;
  writeStoredConfig(cfg);
}

/** Retire l'accès d'une instance. Rend l'accès retiré, pour révocation côté serveur. */
export function removeInstance(url: string, opts: { ai?: boolean } = {}): Instance | undefined {
  const cfg = readStoredConfig();
  const key = normalizeUrl(url);
  const bucket = opts.ai ? (cfg.aiInstances ?? {}) : cfg.instances;
  const removed = bucket[key];
  delete bucket[key];
  const known = new Set([...Object.keys(cfg.instances), ...Object.keys(cfg.aiInstances ?? {})]);
  if (cfg.defaultUrl && !known.has(cfg.defaultUrl)) {
    cfg.defaultUrl = [...known][0];
  }
  if (known.size === 0) {
    const file = configPath();
    if (existsSync(file)) rmSync(file);
  } else {
    writeStoredConfig(cfg);
  }
  return removed;
}

/**
 * Cherche `.physalis.json` du dossier courant jusqu'à la racine, comme git
 * cherche `.git` : `physalis run` marche depuis n'importe quel sous-dossier.
 */
export function findProjectFile(
  startDir: string = process.cwd(),
): { path: string; config: ProjectFile } | null {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, PROJECT_FILE);
    if (existsSync(candidate)) {
      try {
        return {
          path: candidate,
          config: JSON.parse(readFileSync(candidate, "utf8")) as ProjectFile,
        };
      } catch {
        throw new Error(`${candidate} n'est pas un JSON valide.`);
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Instance ciblée sans exiger project/env (login, logout, whoami). */
export function resolveUrl(flags: Flags): string | undefined {
  const projectFile = findProjectFile()?.config ?? {};
  const url =
    flags.url ??
    process.env.PHYSALIS_URL ??
    projectFile.url ??
    readStoredConfig().defaultUrl;
  return url ? normalizeUrl(url) : undefined;
}

/**
 * Résout le contexte effectif. Priorité (du plus fort au plus faible) :
 *   flags CLI  →  variables d'env  →  .physalis.json  →  accès stocké de l'instance.
 * PHYSALIS_TOKEN prime sur l'accès stocké (cas CI).
 * Lève une erreur lisible si un champ manque ou si la session CLI a expiré.
 */
export function resolveContext(flags: Flags, now: number = Date.now()): Context {
  const stored = readStoredConfig();
  const projectFile = findProjectFile()?.config ?? {};
  const env = process.env;

  const rawUrl = flags.url ?? env.PHYSALIS_URL ?? projectFile.url ?? stored.defaultUrl;
  const url = rawUrl ? normalizeUrl(rawUrl) : undefined;
  const agent = isAgentShell(env);
  const instance = url ? (agent ? stored.aiInstances?.[url] : stored.instances[url]) : undefined;

  const explicitToken = flags.token ?? env.PHYSALIS_TOKEN ?? projectFile.token;
  const token = explicitToken ?? instance?.token;

  if (agent && !token && url) {
    throw new Error(
      `Aucune session agent IA pour ${url}. Depuis TON terminal (pas celui de l'agent) : ` +
        "`physalis login --ai`, puis coche dans le navigateur ce que l'agent peut lire.",
    );
  }

  if (
    !explicitToken &&
    instance?.kind === "cli" &&
    instance.expiresAt !== undefined &&
    instance.expiresAt * 1000 <= now
  ) {
    throw new Error(`Session expirée sur ${url}. Relance \`physalis login\`.`);
  }

  const project = flags.project ?? env.PHYSALIS_PROJECT ?? projectFile.project ?? instance?.project;
  const envName = flags.env ?? env.PHYSALIS_ENV ?? projectFile.env ?? instance?.env;

  const missing: string[] = [];
  if (!url) missing.push("url (--url, PHYSALIS_URL, .physalis.json ou `physalis login`)");
  if (!token) missing.push("accès (`physalis login`, ou PHYSALIS_TOKEN)");
  if (!project) missing.push("project (--project/-p, PHYSALIS_PROJECT ou .physalis.json)");
  if (!envName) missing.push("env (--env/-e, PHYSALIS_ENV ou .physalis.json)");
  if (missing.length) {
    throw new Error(`Contexte incomplet — manque :\n  - ${missing.join("\n  - ")}`);
  }

  return { url: url!, token: token!, project: project!, env: envName! };
}
