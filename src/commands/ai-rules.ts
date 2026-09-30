// `physalis ai-rules` — règles de refus à coller dans `.claude/settings.json`
// (chantier agent-ssh, phase 2d, scénario S4).
//
// Elles empêchent Claude Code de lancer, par erreur, les commandes qui
// affichent ou écrivent des valeurs de secrets. Ce sont des garde-fous contre
// l'accident, pas une barrière : la barrière est le périmètre de la session IA,
// appliqué par l'instance.

export const AI_DENY_RULES: readonly string[] = [
  "Bash(physalis secrets:*)",
  "Bash(physalis export:*)",
  "Bash(physalis pull:*)",
  "Bash(physalis login --token:*)",
  "Bash(printenv:*)",
  "Bash(env)",
  "Read(~/.physalis/**)",
];

export function aiRulesCommand(): number {
  process.stdout.write(JSON.stringify({ permissions: { deny: AI_DENY_RULES } }, null, 2) + "\n");
  process.stderr.write(
    "\nÀ fusionner dans .claude/settings.json (projet) ou ~/.claude/settings.json.\n" +
      "Puis, depuis TON terminal : physalis login --ai — et coche ce que l'agent peut lire.\n",
  );
  return 0;
}
