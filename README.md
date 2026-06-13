# @physalis/cli

CLI du gestionnaire de secrets **Physalis** (self-host). Son intérêt principal :

> **`physalis run -- <commande>`** injecte tes secrets en variables
> d'environnement du process, **sans jamais les écrire sur le disque**.

Zéro dépendance runtime (Node ≥ 18 : `fetch` natif, `child_process`).

## Installation

```bash
npm install -g @physalis/cli   # ou: npx @physalis/cli ...
```

## Démarrage

```bash
# 1. Se connecter (colle un token sv_… créé dans l'UI Physalis)
physalis login --url https://vault.exemple.fr
# (interactif : demande URL, token, et projet/env par défaut optionnels)

# 2. Lancer une commande avec les secrets injectés (rien sur le disque)
physalis run -p mon-projet -e production -- node app.js
```

## Commandes

| Commande | Rôle |
|---|---|
| `physalis login` | Stocke l'URL + le token dans `~/.physalis/config.json` (`0600`). |
| `physalis logout` | Efface le token. |
| `physalis whoami` | Affiche l'URL, le projet/env résolus et le token (masqué). |
| `physalis run -- <cmd…>` | **Héros.** Récupère `(project, env)`, injecte les secrets en env, exécute `<cmd>`. Propage signaux + code de sortie. Fail-closed. |
| `physalis secrets [--reveal]` | Liste les **clés** (valeurs masquées sauf `--reveal`). |
| `physalis secrets get <KEY>` | Une valeur brute (scripting). |
| `physalis export [--format=env\|json]` | Sortie stdout (`physalis export > .env` pour docker-compose). |

## Résolution de `(url, token, project, env)`

Priorité, du plus fort au plus faible :

1. **Flags** : `--url`, `--token`, `-p/--project`, `-e/--env`
2. **Variables d'env** : `PHYSALIS_URL`, `PHYSALIS_TOKEN`, `PHYSALIS_PROJECT`, `PHYSALIS_ENV`
3. **`.physalis.json`** (dans le dossier courant) :
   ```json
   { "project": "mon-projet", "env": "production" }
   ```
4. **Config stockée** (`~/.physalis/config.json`, via `physalis login`)

`PHYSALIS_TOKEN` est l'override idéal pour la **CI** (token machine, non-interactif).

## Sécurité

- Le token est au repos en `0600` (chiffré par le système de fichiers). Un token
  volé = lecture des secrets de sa portée → **TTL court + révocation depuis l'UI**.
- `physalis run` n'écrit **aucun** fichier : les secrets ne vivent que dans
  l'environnement du process enfant, en mémoire.
- **Fail-closed** : si la récupération des secrets échoue, la commande n'est
  **pas** lancée (jamais de process avec des secrets manquants en silence).

## Build (dev)

```bash
npm install
npm run build      # → dist/
npm run watch      # tsc --watch
```

## Licence

MIT
