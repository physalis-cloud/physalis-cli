// `physalis run -- <cmd...>` — LE héros.
// Récupère les secrets (project, env), les injecte en variables d'env du
// process enfant, exécute <cmd>, RIEN sur le disque. Propage les signaux et
// le code de sortie. Fail-closed : si le fetch échoue, on ne lance PAS <cmd>.

import { spawn } from "node:child_process";
import { constants } from "node:os";
import { isAgentShell, resolveContext, type Flags } from "../config.js";
import { fetchSecrets } from "../client.js";
import { pipeMasked } from "../mask.js";

/**
 * Masquer la sortie ? D'office dans le shell d'un agent IA (il LIT la sortie
 * de ses commandes) ; sur demande sinon (`--mask`), car les tubes font perdre
 * le terminal interactif : couleurs, invites, barres de progression.
 * `--no-mask` ne désactive rien chez un agent : on n'y retire pas un garde-fou.
 */
export function shouldMask(flags: { mask?: boolean }, env: NodeJS.ProcessEnv = process.env): boolean {
  if (isAgentShell(env)) return true;
  return flags.mask === true || env.PHYSALIS_MASK === "1";
}

export async function runCommand(flags: Flags & { mask?: boolean }, cmd: string[]): Promise<number> {
  if (cmd.length === 0) {
    process.stderr.write(
      "usage : physalis run [-p <project>] [-e <env>] -- <commande...>\n",
    );
    return 2;
  }

  const ctx = resolveContext(flags); // throw si contexte incomplet (fail-closed)
  const secrets = await fetchSecrets(ctx); // throw si KO (fail-closed)

  const [bin, ...args] = cmd;
  const mask = shouldMask(flags);
  const child = spawn(bin!, args, {
    stdio: mask ? ["inherit", "pipe", "pipe"] : "inherit",
    // Secrets injectés UNIQUEMENT dans l'env de l'enfant, en mémoire.
    env: { ...process.env, ...secrets },
  });
  const values = Object.values(secrets);
  const drained = mask
    ? Promise.all([
        pipeMasked(child.stdout!, process.stdout, values),
        pipeMasked(child.stderr!, process.stderr, values),
      ])
    : Promise.resolve();

  // Forwarding des signaux → enfant (Ctrl-C, arrêt propre).
  const forward = (sig: NodeJS.Signals) => {
    if (!child.killed) child.kill(sig);
  };
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const s of signals) process.on(s, () => forward(s));

  return await new Promise<number>((resolve) => {
    child.on("error", (err) => {
      process.stderr.write(`physalis run: impossible de lancer « ${bin} » : ${err.message}\n`);
      resolve(127);
    });
    // `close` (et pas `exit`) : attendre que la sortie masquée soit vidée.
    child.on("close", async (code, signal) => {
      await drained;
      // Propage le code exact ; si tué par signal, convention 128+signo.
      if (signal) {
        const signo = (constants.signals as Record<string, number>)[signal] ?? 0;
        resolve(signo ? 128 + signo : 1);
      } else {
        resolve(code ?? 0);
      }
    });
  });
}
