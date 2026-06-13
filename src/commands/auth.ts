// login / logout / whoami.
// V1 : `login` stocke un token créé dans l'UI (pas de device-flow). Interactif,
// ou non-interactif via --url/--token/-p/-e. Stockage 0600 (cf. config.ts).

import { createInterface } from "node:readline/promises";
import {
  readStoredConfig,
  writeStoredConfig,
  clearStoredConfig,
  resolveContext,
  configPath,
  type Flags,
} from "../config.js";

function maskToken(t: string): string {
  if (t.length <= 12) return "••••";
  return `${t.slice(0, 8)}…${t.slice(-4)}`;
}

export async function loginCommand(
  flags: Flags & { url?: string; token?: string },
): Promise<number> {
  const current = readStoredConfig();
  let { url, token, project, env } = flags;

  // Mode interactif si des champs manquent ET stdin est un TTY.
  if ((!url || !token) && process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      if (!url) {
        const def = current.url ?? "http://localhost:3000";
        const ans = (await rl.question(`URL de l'instance [${def}] : `)).trim();
        url = ans || def;
      }
      if (!token) {
        token = (await rl.question("Token (sv_… créé dans l'UI) : ")).trim();
      }
      if (!project) {
        const ans = (await rl.question(`Projet par défaut (optionnel)${current.project ? ` [${current.project}]` : ""} : `)).trim();
        project = ans || current.project;
      }
      if (!env) {
        const ans = (await rl.question(`Environnement par défaut (optionnel)${current.env ? ` [${current.env}]` : ""} : `)).trim();
        env = ans || current.env;
      }
    } finally {
      rl.close();
    }
  }

  if (!url || !token) {
    process.stderr.write(
      "login : URL et token requis (interactif, ou --url <url> --token <sv_…>).\n",
    );
    return 2;
  }

  writeStoredConfig({
    url: url.replace(/\/$/, ""),
    token,
    ...(project ? { project } : {}),
    ...(env ? { env } : {}),
  });
  process.stderr.write(
    `✓ Connecté à ${url} (token ${maskToken(token)}). Config : ${configPath()} (0600).\n`,
  );
  return 0;
}

export function logoutCommand(): number {
  clearStoredConfig();
  process.stderr.write("✓ Token supprimé.\n");
  return 0;
}

export function whoamiCommand(flags: Flags): number {
  let ctx;
  try {
    ctx = resolveContext(flags);
  } catch {
    process.stderr.write("Non connecté (aucun token résolu). Lance `physalis login`.\n");
    return 1;
  }
  const tokenSource = process.env.PHYSALIS_TOKEN ? "PHYSALIS_TOKEN (env)" : "config stockée";
  process.stdout.write(
    [
      `url      : ${ctx.url}`,
      `project  : ${ctx.project}`,
      `env      : ${ctx.env}`,
      `token    : ${maskToken(ctx.token)} (${tokenSource})`,
    ].join("\n") + "\n",
  );
  return 0;
}
