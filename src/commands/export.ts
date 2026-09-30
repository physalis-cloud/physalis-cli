// `physalis export [--format=env|json]` → sortie stdout des secrets.
// Successeur de scripts/inject-secrets.sh pour le pattern docker-compose :
// l'écriture disque est OPT-IN (`physalis export > .env`), jamais implicite.

import { resolveContext, type Flags } from "../config.js";
import { fetchSecrets } from "../client.js";

// Échappe une valeur pour un fichier .env (guillemets doubles + \n, \", \\).
export function toEnvLine(key: string, value: string): string {
  const needsQuote = /[\s"'#=\\]/.test(value) || value === "";
  if (!needsQuote) return `${key}=${value}`;
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  return `${key}="${escaped}"`;
}

export async function exportCommand(
  flags: Flags & { format?: string },
): Promise<number> {
  const format = flags.format ?? "env";
  if (format !== "env" && format !== "json") {
    process.stderr.write("--format doit être `env` ou `json`.\n");
    return 2;
  }

  const ctx = resolveContext(flags);
  const secrets = await fetchSecrets(ctx);
  const keys = Object.keys(secrets).sort();

  if (format === "json") {
    const ordered: Record<string, string> = {};
    for (const k of keys) ordered[k] = secrets[k]!;
    process.stdout.write(JSON.stringify(ordered, null, 2) + "\n");
  } else {
    for (const k of keys) process.stdout.write(toEnvLine(k, secrets[k]!) + "\n");
  }
  return 0;
}
