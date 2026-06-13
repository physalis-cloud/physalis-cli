// `physalis run -- <cmd...>` — LE héros.
// Récupère les secrets (project, env), les injecte en variables d'env du
// process enfant, exécute <cmd>, RIEN sur le disque. Propage les signaux et
// le code de sortie. Fail-closed : si le fetch échoue, on ne lance PAS <cmd>.

import { spawn } from "node:child_process";
import { constants } from "node:os";
import { resolveContext, type Flags } from "../config.js";
import { fetchSecrets } from "../client.js";

export async function runCommand(flags: Flags, cmd: string[]): Promise<number> {
  if (cmd.length === 0) {
    process.stderr.write(
      "usage : physalis run [-p <project>] [-e <env>] -- <commande...>\n",
    );
    return 2;
  }

  const ctx = resolveContext(flags); // throw si contexte incomplet (fail-closed)
  const secrets = await fetchSecrets(ctx); // throw si KO (fail-closed)

  const [bin, ...args] = cmd;
  const child = spawn(bin!, args, {
    stdio: "inherit",
    // Secrets injectés UNIQUEMENT dans l'env de l'enfant, en mémoire.
    env: { ...process.env, ...secrets },
  });

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
    child.on("exit", (code, signal) => {
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
