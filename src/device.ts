// Flux d'appareil de `physalis login` (sur le modèle de RFC 8628).
//
// Contrat côté instance (chantier agent-ssh, phase 2) :
//   POST /api/cli/device/start  { deviceName, kind: "HUMAN" | "AI" }
//     → 200 { deviceCode, userCode, verificationUri, verificationUriComplete,
//             expiresIn, interval }
//   POST /api/cli/device/poll   { deviceCode }
//     → 200 { token: "sv_cli_…", expiresAt, email }
//     → 400 { error: "authorization_pending" | "slow_down" | "access_denied"
//                    | "expired_token" }
//   DELETE /api/cli/session     (Bearer sv_cli_…) → 204, révoque la session
//
// Le jeton n'est créé qu'au poll qui suit l'approbation, et rendu une seule
// fois : l'instance n'en garde que le hash.

export type DeviceStart = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
};

export type DeviceGrant = {
  token: string;
  expiresAt: number;
  email?: string;
};

export type DeviceDeps = {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

export const defaultDeps: DeviceDeps = {
  fetch: (...args) => fetch(...args),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
};

export class DeviceFlowError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "DeviceFlowError";
  }
}

async function postJson(
  deps: DeviceDeps,
  url: string,
  body: unknown,
): Promise<{ status: number; data: Record<string, unknown> | null }> {
  let res: Response;
  try {
    res = await deps.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new DeviceFlowError(
      `Connexion impossible à ${new URL(url).origin} (${(err as Error).message})`,
      "network",
    );
  }
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, data };
}

export async function startDeviceFlow(
  baseUrl: string,
  deviceName: string,
  deps: DeviceDeps = defaultDeps,
  kind: "HUMAN" | "AI" = "HUMAN",
): Promise<DeviceStart> {
  const { status, data } = await postJson(deps, `${baseUrl}/api/cli/device/start`, {
    deviceName,
    kind,
  });
  if (status === 404) {
    throw new DeviceFlowError(
      `${baseUrl} ne propose pas encore la connexion par navigateur. ` +
        "Utilise `physalis login --token <sv_…>` avec un token créé dans l'interface.",
      "unsupported",
    );
  }
  if (status !== 200 || !data || typeof data.deviceCode !== "string" || typeof data.userCode !== "string") {
    throw new DeviceFlowError(`Démarrage de la connexion refusé (HTTP ${status}).`, "start_failed");
  }
  return {
    deviceCode: data.deviceCode,
    userCode: data.userCode,
    verificationUri: String(data.verificationUri ?? `${baseUrl}/account/cli`),
    verificationUriComplete: String(
      data.verificationUriComplete ?? data.verificationUri ?? `${baseUrl}/account/cli`,
    ),
    expiresIn: Number(data.expiresIn ?? 600),
    interval: Math.max(1, Number(data.interval ?? 5)),
  };
}

/**
 * Attend l'approbation dans le navigateur. Respecte `interval`, l'allonge de
 * 5 s sur `slow_down`, abandonne à l'expiration du code.
 */
export async function pollDeviceFlow(
  baseUrl: string,
  start: DeviceStart,
  deps: DeviceDeps = defaultDeps,
): Promise<DeviceGrant> {
  const deadline = deps.now() + start.expiresIn * 1000;
  let interval = start.interval;

  while (deps.now() < deadline) {
    await deps.sleep(interval * 1000);
    const { status, data } = await postJson(deps, `${baseUrl}/api/cli/device/poll`, {
      deviceCode: start.deviceCode,
    });

    if (status === 200 && data && typeof data.token === "string") {
      return {
        token: data.token,
        expiresAt: Number(data.expiresAt),
        ...(typeof data.email === "string" ? { email: data.email } : {}),
      };
    }

    const error = typeof data?.error === "string" ? data.error : `http_${status}`;
    switch (error) {
      case "authorization_pending":
        continue;
      case "slow_down":
        interval += 5;
        continue;
      case "access_denied":
        throw new DeviceFlowError("Connexion refusée dans le navigateur.", error);
      case "expired_token":
        throw new DeviceFlowError("Le code a expiré. Relance `physalis login`.", error);
      default:
        throw new DeviceFlowError(`Réponse inattendue de l'instance (${error}).`, error);
    }
  }
  throw new DeviceFlowError("Le code a expiré. Relance `physalis login`.", "expired_token");
}

/** Révoque la session côté instance. Best-effort : un échec n'empêche pas le logout local. */
export async function revokeSession(
  baseUrl: string,
  token: string,
  deps: DeviceDeps = defaultDeps,
): Promise<boolean> {
  try {
    const res = await deps.fetch(`${baseUrl}/api/cli/session`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}
