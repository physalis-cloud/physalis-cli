// login / logout / whoami.
//
// `login` ouvre une session CLI par flux d'appareil : un code s'affiche, on
// l'approuve dans le navigateur, la session (12 h) donne accès à tous les
// projets de l'utilisateur sur cette instance. `login --token <sv_…>` garde
// l'ancien mode (token machine lié à un projet), utile hors navigateur.

import { spawn } from "node:child_process";
import { hostname, platform } from "node:os";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import {
  readStoredConfig,
  saveInstance,
  removeInstance,
  resolveContext,
  resolveUrl,
  normalizeUrl,
  kindOfToken,
  configPath,
  isAgentShell,
  type Flags,
} from "../config.js";
import { startDeviceFlow, pollDeviceFlow, revokeSession } from "../device.js";

function maskToken(t: string): string {
  if (t.length <= 12) return "••••";
  return `${t.slice(0, 8)}…${t.slice(-4)}`;
}

/** Où le jeton a été rangé, dit à l'utilisateur. */
function whereStored(where: "keychain" | "file", ai: boolean): string {
  if (where === "keychain") return "  Jeton rangé dans le trousseau du système.\n";
  if (ai) return `  Session IA dans ${configPath()} (0600), lisible par l'agent — c'est voulu.\n`;
  return (
    `  ⚠️ Pas de trousseau du système disponible (serveur, WSL, conteneur) : jeton dans ${configPath()} (0600).\n` +
    "  Un agent IA lancé sous ton utilisateur pourrait le lire.\n"
  );
}

function formatExpiry(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString();
}

function isWsl(): boolean {
  if (platform() !== "linux") return false;
  try {
    return /microsoft/i.test(readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

/** Ouvre l'URL dans le navigateur. Silencieux en cas d'échec : l'URL est affichée. */
function openBrowser(url: string): void {
  const [cmd, args] =
    platform() === "darwin"
      ? ["open", [url]]
      : platform() === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : isWsl()
          ? ["cmd.exe", ["/c", "start", "", url.replace(/&/g, "^&")]]
          : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args as string[], { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // pas de navigateur : l'utilisateur ouvre l'URL affichée.
  }
}

async function askUrl(current?: string): Promise<string | undefined> {
  if (!process.stdin.isTTY) return current;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const hint = current ? ` [${current}]` : " (ex. https://mon-org.physalis.cloud)";
    const ans = (await rl.question(`URL de l'instance${hint} : `)).trim();
    return ans || current;
  } finally {
    rl.close();
  }
}

export async function loginCommand(
  flags: Flags & { noBrowser?: boolean; ai?: boolean },
): Promise<number> {
  // Dans le shell d'un agent, `login` ne peut demander QU'UNE session IA : un
  // humain qui approuve par habitude ne donne pas ses propres droits à l'agent.
  const ai = flags.ai === true || isAgentShell();
  let url = resolveUrl(flags);
  if (!flags.url && !process.env.PHYSALIS_URL) url = await askUrl(url);
  if (!url) {
    process.stderr.write("login : URL de l'instance requise (--url <url>).\n");
    return 2;
  }
  url = normalizeUrl(url);
  const stored = readStoredConfig();
  const previous = ai ? stored.aiInstances?.[url] : stored.instances[url];
  const keep = {
    ...(flags.project ?? previous?.project ? { project: flags.project ?? previous?.project } : {}),
    ...(flags.env ?? previous?.env ? { env: flags.env ?? previous?.env } : {}),
  };

  // Mode token machine : pas de navigateur, un `sv_` lié à un projet.
  if (flags.token && ai) {
    process.stderr.write("login --ai : pas de --token, la session IA s'approuve dans le navigateur.\n");
    return 2;
  }
  if (flags.token) {
    const where = saveInstance(url, { token: flags.token, kind: kindOfToken(flags.token), ...keep });
    process.stderr.write(
      `✓ Token ${maskToken(flags.token)} enregistré pour ${url}.\n` + whereStored(where, false),
    );
    return 0;
  }

  const start = await startDeviceFlow(url, hostname(), undefined, ai ? "AI" : "HUMAN");
  process.stderr.write(
    (ai
      ? "\nSession AGENT IA : dans le navigateur, coche les projets et environnements\n" +
        "que l'agent pourra lire (environnements de développement uniquement).\n"
      : "") +
      `\nOuvre ${start.verificationUriComplete}\n` +
      `et vérifie que le code affiché est :  ${start.userCode}\n\n`,
  );
  if (!flags.noBrowser) openBrowser(start.verificationUriComplete);
  process.stderr.write("En attente de l'approbation… (Ctrl-C pour annuler)\n");

  const grant = await pollDeviceFlow(url, start);
  const where = saveInstance(
    url,
    {
      token: grant.token,
      kind: "cli",
      expiresAt: grant.expiresAt,
      ...(grant.email ? { email: grant.email } : {}),
      ...keep,
    },
    { ai },
  );
  process.stderr.write(
    `✓ ${ai ? "Session agent IA ouverte sur" : "Connecté à"} ${url}` +
      `${grant.email ? ` ${ai ? "au nom de" : "en tant que"} ${grant.email}` : ""}, ` +
      `jusqu'au ${formatExpiry(grant.expiresAt)}.\n` +
      whereStored(where, ai),
  );
  return 0;
}

export async function logoutCommand(flags: Flags & { ai?: boolean }): Promise<number> {
  const ai = flags.ai === true || isAgentShell();
  const url = resolveUrl(flags);
  if (!url) {
    process.stderr.write("Aucune instance connectée.\n");
    return 0;
  }
  const removed = removeInstance(url, { ai });
  if (!removed) {
    process.stderr.write(`Aucun accès enregistré pour ${url}.\n`);
    return 0;
  }
  if (removed.kind === "cli") {
    const revoked = await revokeSession(url, removed.token);
    process.stderr.write(
      revoked
        ? `✓ Session révoquée et supprimée pour ${url}.\n`
        : `✓ Session supprimée localement pour ${url} (révocation serveur impossible : ` +
            "la couper depuis l'interface, Compte → Sessions CLI).\n",
    );
  } else {
    process.stderr.write(
      `✓ Token supprimé localement pour ${url}. Il reste valide tant qu'il n'est pas révoqué dans l'interface.\n`,
    );
  }
  return 0;
}

export function whoamiCommand(flags: Flags): number {
  const url = resolveUrl(flags);
  const agent = isAgentShell();
  const stored = readStoredConfig();
  const instance = url ? (agent ? stored.aiInstances?.[url] : stored.instances[url]) : undefined;
  const fromEnv = Boolean(process.env.PHYSALIS_TOKEN);
  if (!url || (!instance && !fromEnv && !flags.token)) {
    process.stderr.write("Non connecté. Lance `physalis login`.\n");
    return 1;
  }

  const lines = [`url      : ${url}`];
  if (fromEnv || flags.token) {
    const t = flags.token ?? process.env.PHYSALIS_TOKEN!;
    lines.push(`accès    : ${maskToken(t)} (${flags.token ? "--token" : "PHYSALIS_TOKEN"})`);
  } else if (instance) {
    lines.push(
      instance.kind === "cli"
        ? `accès    : ${agent ? "session AGENT IA" : "session CLI"}${instance.email ? ` de ${instance.email}` : ""}, ` +
            (instance.expiresAt
              ? `jusqu'au ${formatExpiry(instance.expiresAt)}`
              : "expiration inconnue (enregistrée par --token)")
        : `accès    : token machine ${instance.store === "keychain" ? "" : `${maskToken(instance.token)} `}(sans expiration)`,
    );
    lines.push(`stockage : ${instance.store === "keychain" ? "trousseau du système" : `${configPath()} (0600)`}`);
  }
  try {
    const ctx = resolveContext(flags);
    lines.push(`project  : ${ctx.project}`, `env      : ${ctx.env}`);
  } catch (err) {
    lines.push(`contexte : ${(err as Error).message.split("\n")[0]}`);
  }
  process.stdout.write(lines.join("\n") + "\n");
  return 0;
}
