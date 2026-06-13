// Client API mince sur le contrat REST self-host. ZÉRO logique métier —
// juste un wrapper typé sur `GET /api/secrets/{project}/{env}` (Bearer).
// Le contrat doit rester stable : on ne couple à aucun endpoint interne.

import type { Context } from "./config.js";

export class PhysalisApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PhysalisApiError";
  }
}

/**
 * Récupère les secrets `(project, env)` en clair (clé → valeur).
 * Fail-closed : toute réponse non-200 lève une PhysalisApiError explicite.
 */
export async function fetchSecrets(
  ctx: Context,
): Promise<Record<string, string>> {
  const url = `${ctx.url}/api/secrets/${encodeURIComponent(ctx.project)}/${encodeURIComponent(ctx.env)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { authorization: `Bearer ${ctx.token}` },
    });
  } catch (err) {
    throw new PhysalisApiError(
      `Connexion impossible à ${ctx.url} (${(err as Error).message})`,
      0,
    );
  }

  if (res.status === 401) {
    throw new PhysalisApiError(
      "Token invalide ou expiré (401). Relance `physalis login` ou vérifie PHYSALIS_TOKEN.",
      401,
    );
  }
  if (res.status === 403) {
    throw new PhysalisApiError(
      `Accès refusé (403) à ${ctx.project}/${ctx.env} — le token n'a pas la portée requise.`,
      403,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new PhysalisApiError(
      `Erreur API ${res.status} sur ${ctx.project}/${ctx.env}${body ? ` : ${body.slice(0, 200)}` : ""}`,
      res.status,
    );
  }

  const data = (await res.json().catch(() => null)) as
    | { secrets?: Record<string, string> }
    | null;
  if (!data || typeof data.secrets !== "object" || data.secrets === null) {
    throw new PhysalisApiError("Réponse API inattendue (pas de champ `secrets`).", res.status);
  }
  return data.secrets;
}
