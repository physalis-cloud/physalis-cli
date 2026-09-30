# physalis-cli

CLI du gestionnaire de secrets **Physalis** (self-host). Son intérêt principal :

> **`physalis run -- <commande>`** injecte tes secrets en variables
> d'environnement du process, **sans jamais les écrire sur le disque**.

Zéro dépendance runtime (Node ≥ 18 : `fetch` natif, `child_process`).

## Installation

```bash
npm install -g physalis-cli   # ou: npx physalis-cli ...
```

## Démarrage

```bash
# 1. Ouvrir une session (une fois par jour et par poste)
physalis login --url https://mon-org.physalis.cloud
#    → affiche un code, ouvre le navigateur : tu l'approuves avec ton compte.
#    La session vaut 12 h et donne accès à TOUS tes projets de l'instance.

# 2. Dans chaque projet, un .physalis.json SANS token (committable)
echo '{ "url": "https://mon-org.physalis.cloud", "project": "mon-projet", "env": "development" }' > .physalis.json

# 3. Lancer une commande avec les secrets injectés (rien sur le disque)
physalis run -- npm run dev
```

> Une instance qui ne propose pas encore la connexion par navigateur se
> connecte avec un token machine : `physalis login --token sv_…` (voir plus bas).

## Commandes

| Commande | Rôle |
|---|---|
| `physalis login [--no-browser]` | Ouvre une session de 12 h par flux d'appareil (code approuvé dans le navigateur). |
| `physalis login --token <sv_…>` | Enregistre un token machine, lié à un projet et un environnement. |
| `physalis logout` | Révoque la session sur l'instance et l'efface localement. |
| `physalis whoami` | Affiche l'instance, le type d'accès et son expiration, le projet/env résolus. |
| `physalis run -- <cmd…>` | **Héros.** Récupère `(project, env)`, injecte les secrets en env, exécute `<cmd>`. Propage signaux + code de sortie. Fail-closed. |
| `physalis secrets [--reveal]` | Liste les **clés** (valeurs masquées sauf `--reveal`). |
| `physalis secrets get <KEY>` | Une valeur brute (scripting). |
| `physalis export [--format=env\|json]` | Sortie stdout. ⚠️ `physalis export > .env` recrée le fichier en clair que `run` évite. |

## Plusieurs projets, plusieurs instances

Les accès sont rangés **par instance** (URL) dans `~/.physalis/config.json`.
Une session donne accès à tous les projets de ton compte sur son instance ;
travailler pour deux organisations sur deux instances = deux `physalis login`.
Le `url` du `.physalis.json` choisit la bonne session.

`.physalis.json` est cherché dans le dossier courant **puis dans ses parents**,
comme `.git` : `physalis run` marche depuis n'importe quel sous-dossier.

## Résolution de `(url, accès, project, env)`

Priorité, du plus fort au plus faible :

1. **Flags** : `--url`, `--token`, `-p/--project`, `-e/--env`
2. **Variables d'env** : `PHYSALIS_URL`, `PHYSALIS_TOKEN`, `PHYSALIS_PROJECT`, `PHYSALIS_ENV`
3. **`.physalis.json`** (dossier courant ou parent) :
   ```json
   { "url": "https://mon-org.physalis.cloud", "project": "mon-projet", "env": "development" }
   ```
4. **Accès stocké** de l'instance (`physalis login`)

`PHYSALIS_TOKEN` est l'override idéal pour la **CI** (token machine, non-interactif).
`PHYSALIS_CONFIG_DIR` change l'emplacement de la config (profil séparé).

## Sécurité

- Les accès sont au repos en `0600` (protégés par le système de fichiers
  uniquement). Un accès volé = lecture des secrets de sa portée.
  - **Session CLI** : expire au bout de 12 h, révocable depuis l'interface
    (Compte → Sessions CLI) ou par `physalis logout`.
  - **Token machine `sv_…`** : **n'expire pas**. Il reste valide jusqu'à sa
    révocation dans l'interface ; `physalis logout` ne l'efface que localement.
- `physalis run` n'écrit **aucun** fichier : les secrets ne vivent que dans
  l'environnement du process enfant, en mémoire.
- **Fail-closed** : si la récupération des secrets échoue, la commande n'est
  **pas** lancée (jamais de process avec des secrets manquants en silence).

## Build (dev)

```bash
npm install
npm run build      # → dist/
npm run watch      # tsc --watch
npm run test       # tests node:test (zéro dépendance)
```

## Licence

MIT
