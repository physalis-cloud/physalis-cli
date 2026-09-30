// Trousseau du système pour la session HUMAINE (chantier agent-ssh, phase 2f,
// option B du scénario S4).
//
// Pourquoi : un agent IA lancé sous le même utilisateur peut lire
// ~/.physalis/config.json — donc prendre la session de l'humain, qui lit la
// production. Dans le trousseau, le jeton n'est plus dans ce fichier.
//
// Sans dépendance npm : on appelle les outils du système.
//   - macOS : `security` (trousseau de session) ;
//   - Linux : `secret-tool` (libsecret / Secret Service : GNOME Keyring,
//     KWallet) — absent sur un serveur, en WSL, dans un conteneur.
//   - Windows : Credential Manager n'a pas d'outil en ligne de commande qui
//     RELISE un secret ; rattaché à la phase 5 (Windows). Repli sur le fichier.
//
// Limites, à dire : sous Linux, libsecret ne distingue pas deux processus du
// même utilisateur (`secret-tool lookup` reste possible pour un agent) ; sous
// macOS, `security add-generic-password -w` reçoit le jeton en argument, visible
// dans `ps` le temps de l'appel. Le trousseau ferme la LECTURE D'UN FICHIER, pas
// un logiciel malveillant actif.

import { spawnSync } from "node:child_process";

export const KEYCHAIN_SERVICE = "physalis-cli";

export type Keychain = {
  name: string;
  get(account: string): string | null;
  set(account: string, secret: string): boolean;
  delete(account: string): void;
};

type Run = typeof spawnSync;

function out(res: ReturnType<Run>): string | null {
  if (res.error || res.status !== 0) return null;
  const text = String(res.stdout ?? "").replace(/\r?\n$/, "");
  return text || null;
}

function macKeychain(run: Run): Keychain {
  return {
    name: "trousseau macOS",
    get: (account) =>
      out(run("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"], { encoding: "utf8" })),
    set: (account, secret) => {
      const res = run(
        "security",
        ["add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", account, "-w", secret],
        { stdio: "ignore" },
      );
      return !res.error && res.status === 0;
    },
    delete: (account) => {
      run("security", ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account], { stdio: "ignore" });
    },
  };
}

function secretServiceKeychain(run: Run): Keychain {
  return {
    name: "trousseau du système (Secret Service)",
    get: (account) =>
      out(run("secret-tool", ["lookup", "service", KEYCHAIN_SERVICE, "account", account], { encoding: "utf8" })),
    // Le secret passe par l'entrée standard, jamais en argument.
    set: (account, secret) => {
      const res = run(
        "secret-tool",
        ["store", "--label", `Physalis CLI (${account})`, "service", KEYCHAIN_SERVICE, "account", account],
        { input: secret, stdio: ["pipe", "ignore", "ignore"] },
      );
      return !res.error && res.status === 0;
    },
    delete: (account) => {
      run("secret-tool", ["clear", "service", KEYCHAIN_SERVICE, "account", account], { stdio: "ignore" });
    },
  };
}

function hasCommand(cmd: string, run: Run): boolean {
  const res = run(cmd, ["--help"], { stdio: "ignore" });
  return !res.error;
}

/**
 * Le trousseau disponible, ou null (repli sur le fichier 0600).
 * `PHYSALIS_NO_KEYCHAIN=1` force le repli (serveur, tests).
 */
export function detectKeychain(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  run: Run = spawnSync,
): Keychain | null {
  if (env.PHYSALIS_NO_KEYCHAIN === "1") return null;
  if (platform === "darwin" && hasCommand("security", run)) return macKeychain(run);
  if (platform === "linux" && env.DBUS_SESSION_BUS_ADDRESS && hasCommand("secret-tool", run)) {
    return secretServiceKeychain(run);
  }
  return null;
}

/** Clé d'un accès humain dans le trousseau : une par instance. */
export function keychainAccount(url: string): string {
  return `human:${url}`;
}
