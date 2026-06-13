#!/usr/bin/env node
// physalis — CLI self-host. Dispatch + parsing (zéro dépendance).

import { parseArgs } from "node:util";
import type { Flags } from "./config.js";
import { runCommand } from "./commands/run.js";
import { secretsListCommand, secretsGetCommand } from "./commands/secrets.js";
import { exportCommand } from "./commands/export.js";
import { loginCommand, logoutCommand, whoamiCommand } from "./commands/auth.js";

const HELP = `physalis — gestionnaire de secrets self-host (CLI)

Usage :
  physalis login [--url <url>] [--token <sv_…>] [-p <project>] [-e <env>]
  physalis logout
  physalis whoami
  physalis run [-p <project>] [-e <env>] -- <commande...>
  physalis secrets [--reveal] [-p <project>] [-e <env>]
  physalis secrets get <KEY> [-p <project>] [-e <env>]
  physalis export [--format=env|json] [-p <project>] [-e <env>]

Options communes :
  -p, --project   projet (sinon PHYSALIS_PROJECT, .physalis.json, config)
  -e, --env       environnement (sinon PHYSALIS_ENV, .physalis.json, config)
      --url       URL de l'instance (sinon PHYSALIS_URL, config)
      --token     token sv_… (sinon PHYSALIS_TOKEN, config)
  -h, --help      cette aide

Le héros : « physalis run -- node app.js » injecte les secrets en variables
d'env du process, sans jamais écrire de fichier sur le disque.`;

const OPTIONS = {
  project: { type: "string", short: "p" },
  env: { type: "string", short: "e" },
  url: { type: "string" },
  token: { type: "string" },
  reveal: { type: "boolean" },
  format: { type: "string" },
  help: { type: "boolean", short: "h" },
} as const;

function parse(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: OPTIONS,
    allowPositionals: true,
  });
  const flags: Flags & { reveal?: boolean; format?: string } = {
    project: values.project,
    env: values.env,
    url: values.url,
    token: values.token,
    reveal: values.reveal,
    format: values.format,
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
      return logoutCommand();
    case "whoami":
      return whoamiCommand(flags);
    case "secrets":
      if (positionals[0] === "get") {
        return await secretsGetCommand(flags, positionals[1]);
      }
      return await secretsListCommand(flags);
    case "export":
      return await exportCommand(flags);
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
