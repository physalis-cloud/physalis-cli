// `physalis secrets`        → liste les CLÉS (valeurs masquées sauf --reveal)
// `physalis secrets get KEY` → une valeur brute (scripting)

import { resolveContext, type Flags } from "../config.js";
import { fetchSecrets } from "../client.js";

export async function secretsListCommand(
  flags: Flags & { reveal?: boolean },
): Promise<number> {
  const ctx = resolveContext(flags);
  const secrets = await fetchSecrets(ctx);
  const keys = Object.keys(secrets).sort();

  if (keys.length === 0) {
    process.stderr.write(`(aucun secret dans ${ctx.project}/${ctx.env})\n`);
    return 0;
  }

  for (const k of keys) {
    if (flags.reveal) {
      process.stdout.write(`${k}=${secrets[k]}\n`);
    } else {
      const v = secrets[k] ?? "";
      const masked = v.length <= 4 ? "••••" : `${v.slice(0, 2)}••••${v.slice(-2)}`;
      process.stdout.write(`${k}  ${masked}\n`);
    }
  }
  return 0;
}

export async function secretsGetCommand(
  flags: Flags,
  key: string | undefined,
): Promise<number> {
  if (!key) {
    process.stderr.write("usage : physalis secrets get <KEY>\n");
    return 2;
  }
  const ctx = resolveContext(flags);
  const secrets = await fetchSecrets(ctx);
  if (!(key in secrets)) {
    process.stderr.write(`Clé « ${key} » introuvable dans ${ctx.project}/${ctx.env}.\n`);
    return 1;
  }
  // Valeur brute sur stdout (pour `$(physalis secrets get X)`), sans newline parasite.
  process.stdout.write(secrets[key]!);
  return 0;
}
