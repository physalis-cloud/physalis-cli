#!/usr/bin/env node
// physalis — CLI self-host. Dispatch + parsing (zéro dépendance).

import { parseArgs } from "node:util";
import type { Flags } from "./config.js";
import { runCommand } from "./commands/run.js";
import { secretsListCommand, secretsGetCommand } from "./commands/secrets.js";
import { exportCommand } from "./commands/export.js";
import { pullCommand } from "./commands/pull.js";
import { aiRulesCommand } from "./commands/ai-rules.js";
import { loginCommand, logoutCommand, whoamiCommand } from "./commands/auth.js";

const HELP = `physalis — gestionnaire de secrets self-host (CLI)

Usage :
  physalis login [--url <url>] [--no-browser] [--ai] [-p <project>] [-e <env>]
  physalis login --token <sv_…> [--url <url>] [-p <project>] [-e <env>]
  physalis logout [--url <url>] [--ai]
  physalis whoami [--url <url>]
  physalis run [-p <project>] [-e <env>] -- <commande...>
  physalis secrets [--reveal] [-p <project>] [-e <env>]
  physalis secrets get <KEY> [-p <project>] [-e <env>]
  physalis export [--format=env|json] [-p <project>] [-e <env>]
  physalis pull [--output <fichier>] [-p <project>] [-e <env>]
  physalis ai-rules

Options communes :
  -p, --project   projet (sinon PHYSALIS_PROJECT, .physalis.json, config)
  -e, --env       environnement (sinon PHYSALIS_ENV, .physalis.json, config)
      --url       URL de l'instance (sinon PHYSALIS_URL, .physalis.json, config)
      --token     token machine sv_… (sinon PHYSALIS_TOKEN, config)
      --no-browser  login : afficher l'URL sans ouvrir le navigateur
      --output    pull : fichier à écrire (défaut : .env à la racine du projet)
      --ai        login/logout : session AGENT IA (ex. Claude Code), périmètre
                  choisi dans le navigateur, dev uniquement, lecture seule
  -h, --help      cette aide

« physalis login » ouvre une session de 12 h, approuvée dans le navigateur, qui
donne accès à tous tes projets de l'instance. Dans chaque projet, un
.physalis.json (sans token, committable) indique url, project et env ; il est
cherché en remontant les dossiers, comme .git.

Agent IA (Claude Code) : « physalis ai-rules » donne les règles de refus à
coller dans .claude/settings.json, puis « physalis login --ai » (depuis TON
terminal) ouvre une session à part, limitée à ce que tu coches. Dans le shell
de l'agent (CLAUDECODE=1), la CLI n'utilise que cette session.

Le héros : « physalis run -- node app.js » injecte les secrets en variables
d'env du process, sans jamais écrire de fichier sur le disque.`;

const OPTIONS = {
  project: { type: "string", short: "p" },
  env: { type: "string", short: "e" },
  url: { type: "string" },
  token: { type: "string" },
  reveal: { type: "boolean" },
  format: { type: "string" },
  "no-browser": { type: "boolean" },
  output: { type: "string" },
  ai: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

function parse(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: OPTIONS,
    allowPositionals: true,
  });
  const flags: Flags & {
    reveal?: boolean;
    format?: string;
    noBrowser?: boolean;
    output?: string;
    ai?: boolean;
  } = {
    project: values.project,
    env: values.env,
    url: values.url,
    token: values.token,
    reveal: values.reveal,
    format: values.format,
    noBrowser: values["no-browser"],
    output: values.output,
    ai: values.ai,
  };
  return { flags, positionals, help: values.help === true };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(HELP + "\n");
    return 0;
  }

  // `run` : tout ce qui suit `--` est la commande enfant (parsing manuel).
  if (command === "run") {
    const rest = argv.slice(1);
    const sep = rest.indexOf("--");
    const flagTokens = sep === -1 ? rest : rest.slice(0, sep);
    const cmd = sep === -1 ? [] : rest.slice(sep + 1);
    const { flags, help } = parse(flagTokens);
    if (help) {
      process.stdout.write(HELP + "\n");
      return 0;
    }
    return await runCommand(flags, cmd);
  }

  const { flags, positionals, help } = parse(argv.slice(1));
  if (help) {
    process.stdout.write(HELP + "\n");
    return 0;
  }

  switch (command) {
    case "login":
      return await loginCommand(flags);
    case "logout":
      return await logoutCommand(flags);
    case "whoami":
      return whoamiCommand(flags);
    case "secrets":
      if (positionals[0] === "get") {
        return await secretsGetCommand(flags, positionals[1]);
      }
      return await secretsListCommand(flags);
    case "export":
      return await exportCommand(flags);
    case "pull":
      return await pullCommand(flags);
    case "ai-rules":
      return aiRulesCommand();
    default:
      process.stderr.write(`Commande inconnue : « ${command} ». Voir « physalis --help ».\n`);
      return 2;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`physalis: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
