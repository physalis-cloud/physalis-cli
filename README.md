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
| `physalis run [--mask] -- <cmd…>` | **Héros.** Récupère `(project, env)`, injecte les secrets en env, exécute `<cmd>`. Propage signaux + code de sortie. Fail-closed. |
| `physalis secrets [--reveal]` | Liste les **clés** (valeurs masquées sauf `--reveal`). |
| `physalis secrets get <KEY>` | Une valeur brute (scripting). |
| `physalis export [--format=env\|json]` | Sortie stdout. ⚠️ `physalis export > .env` recrée le fichier en clair que `run` évite. |
| `physalis login --ai` | Ouvre une session **agent IA** (ex. Claude Code) : périmètre coché dans le navigateur, voir plus bas. |
| `physalis ai-rules` | Affiche les règles de refus à coller dans `.claude/settings.json`. |
| `physalis pull [--output <fichier>]` | Écrit le `.env` d'un environnement **de dev** pour travailler hors ligne (voir plus bas). |

## Travailler hors ligne : `physalis pull`

`physalis run` a besoin du réseau. Pour coder sans connexion, `physalis pull`
écrit le `.env` du projet — **et c'est la seule commande qui écrit des secrets
en clair sur le disque**, donc elle refuse :

- tout environnement qui n'est pas de développement (`development`, `dev`,
  `local`, `test`, `testing`, `sandbox`) — l'instance le refuse aussi ;
- un fichier que git **n'ignore pas** (il finirait committé) : ajoute `.env` à
  `.gitignore` d'abord.

Le fichier est écrit en `0600` à la racine du projet (dossier du
`.physalis.json`), ou là où `--output` l'indique. Chaque `pull` apparaît dans le
journal d'audit comme un export. Supprime le fichier dès que tu n'en as plus
besoin.

## Masquer les secrets dans la sortie : `--mask`

`physalis run --mask -- <cmd>` remplace toute valeur injectée (6 caractères ou
plus) par `<masqué par Physalis>` dans ce que la commande affiche, sur la
sortie standard et la sortie d'erreur — y compris une valeur coupée entre deux
écritures. **D'office dans le shell d'un agent IA**, qui lit la sortie de ses
commandes ; sur demande pour toi (ou `PHYSALIS_MASK=1`).

Limites : la sortie passe par des tubes, donc la commande perd le terminal
interactif (couleurs, invites) et l'ordre entre sortie standard et sortie
d'erreur n'est plus garanti ; une valeur **transformée** avant d'être affichée
(base64, découpée, écrite dans un fichier) n'est pas reconnue. C'est un filet
contre l'affichage accidentel, pas une barrière.

## Travailler avec un agent IA (Claude Code)

L'agent a **sa propre session**, jamais la tienne :

```bash
physalis ai-rules            # règles de refus → .claude/settings.json
physalis login --ai          # depuis TON terminal
```

Dans le navigateur, la demande est marquée **Agent IA** : tu coches les couples
projet/environnement qu'il peut lire — **environnements de développement
uniquement**, jamais la production. L'instance applique ce périmètre à chaque
lecture, en plus de tes propres droits ; l'agent ne peut jamais faire
`physalis pull`. Chaque lecture est tracée comme venant de l'agent.

Dans le shell de l'agent (`CLAUDECODE=1`, ou `PHYSALIS_AGENT=1` pour un autre
agent), la CLI **n'utilise que la session IA** : `physalis run -- npm test`
marche dans le périmètre coché, et rien d'autre.

> ⚠️ Chez l'agent, `physalis run` masque d'office la sortie : un `printenv`
> accidentel n'affiche que `<masqué par Physalis>`. Un agent qui transforme
> une valeur avant de l'afficher la verrait quand même : ce qui le borne
> réellement, c'est son périmètre (dev uniquement, choisi par toi) et la durée
> de la session (12 h).

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

- **Ta session est rangée dans le trousseau du système** quand il y en a un :
  `security` sur macOS, `secret-tool` (libsecret : GNOME Keyring, KWallet) sur
  Linux. `~/.physalis/config.json` n'en garde alors qu'une référence — un agent
  IA qui lirait ce fichier n'y trouve pas ton accès. Sans trousseau (serveur,
  WSL, conteneur ; Windows pour l'instant), repli sur le fichier `0600`, et
  `login` le dit. `PHYSALIS_NO_KEYCHAIN=1` force le fichier.
  Limites : sous Linux, libsecret ne distingue pas deux processus du même
  utilisateur ; sous macOS, `security` reçoit le jeton en argument le temps de
  l'enregistrement. Le trousseau ferme la lecture d'un fichier, pas un
  logiciel malveillant actif.
- La **session IA** reste dans le fichier `0600` : l'agent doit pouvoir la lire.
- Un accès volé = lecture des secrets de sa portée.
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
npm run dev        # tsc --watch
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit (sources + e2e)
npm run test       # tests unitaires node:test, à côté de leur module
npm run e2e        # parcours de bout en bout (e2e/) : la CLI compilée contre une fausse instance
```

## Licence

MIT
