// Outils des tests de bout en bout : une fausse instance Physalis (HTTP local)
// et la CLI COMPILÉE (dist/index.js) lancée comme un vrai process, dans un
// dossier et un profil jetables. Rien ne touche ~/.physalis ni le trousseau.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";

const CLI = resolve(import.meta.dirname, "..", "dist", "index.js");

export type Request = { method: string; path: string; authorization?: string; body: unknown };

export type FakeInstance = {
  url: string;
  requests: Request[];
  close(): Promise<void>;
};

export type FakeOptions = {
  /** Jetons acceptés sur l'API des secrets. */
  tokens: string[];
  /** Secrets servis, par `project/env`. */
  secrets: Record<string, Record<string, string>>;
  /** Jeton rendu par le flux d'appareil, au 2e poll (le 1er répond « en attente »). */
  deviceToken?: string;
  email?: string;
};

function send(res: ServerResponse, status: number, body?: unknown): void {
  res.writeHead(status, body === undefined ? {} : { "content-type": "application/json" });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : null;
}

/** Le contrat REST self-host, réduit à ce que la CLI appelle (voir src/device.ts, src/client.ts). */
export async function startFakeInstance(opts: FakeOptions): Promise<FakeInstance> {
  const requests: Request[] = [];
  const revoked = new Set<string>();
  let polls = 0;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const body = await readBody(req);
    const authorization = req.headers.authorization;
    requests.push({ method: req.method ?? "", path: url.pathname + url.search, authorization, body });
    const bearer = authorization?.replace(/^Bearer /, "");

    if (req.method === "POST" && url.pathname === "/api/cli/device/start") {
      return send(res, 200, {
        deviceCode: "dev-code",
        userCode: "ABCD-EFGH",
        verificationUri: `${base}/account/cli`,
        verificationUriComplete: `${base}/account/cli?code=ABCD-EFGH`,
        expiresIn: 60,
        interval: 1,
      });
    }
    if (req.method === "POST" && url.pathname === "/api/cli/device/poll") {
      polls += 1;
      if (polls < 2 || !opts.deviceToken) return send(res, 400, { error: "authorization_pending" });
      return send(res, 200, {
        token: opts.deviceToken,
        expiresAt: Math.floor(Date.now() / 1000) + 12 * 3600,
        email: opts.email,
      });
    }
    if (req.method === "DELETE" && url.pathname === "/api/cli/session") {
      if (bearer) revoked.add(bearer);
      return send(res, 204);
    }
    const match = /^\/api\/secrets\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && match) {
      if (!bearer || !opts.tokens.includes(bearer) || revoked.has(bearer)) return send(res, 401);
      const secrets = opts.secrets[`${decodeURIComponent(match[1]!)}/${decodeURIComponent(match[2]!)}`];
      if (!secrets) return send(res, 403);
      return send(res, 200, { secrets });
    }
    send(res, 404);
  });

  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url: base,
    requests,
    close: () => new Promise((done) => server.close(() => done())),
  };
}

export type Workspace = {
  /** Dossier courant de la CLI (le « projet »). */
  dir: string;
  /** Profil de la CLI (PHYSALIS_CONFIG_DIR). */
  configDir: string;
  dispose(): void;
};

export function makeWorkspace(): Workspace {
  const root = mkdtempSync(join(tmpdir(), "physalis-e2e-"));
  return {
    dir: join(root, "projet"),
    configDir: join(root, "profil"),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

export type CliResult = { code: number | null; stdout: string; stderr: string };

/**
 * Lance `physalis <args>`. L'environnement est nettoyé de tout ce qui changerait
 * le parcours : variables PHYSALIS_*, et le marqueur d'agent IA (CLAUDECODE).
 */
export function runCli(ws: Workspace, args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<CliResult> {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("PHYSALIS_") || k === "CLAUDECODE") continue;
    env[k] = v;
  }
  Object.assign(env, { PHYSALIS_CONFIG_DIR: ws.configDir, PHYSALIS_NO_KEYCHAIN: "1" }, extraEnv);

  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: ws.dir, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c));
    child.stderr.on("data", (c: Buffer) => (stderr += c));
    child.on("error", fail);
    child.on("close", (code) => done({ code, stdout, stderr }));
  });
}
