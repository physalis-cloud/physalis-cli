import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startDeviceFlow,
  pollDeviceFlow,
  revokeSession,
  DeviceFlowError,
  type DeviceDeps,
  type DeviceStart,
} from "./device.js";

const BASE = "https://alpha.physalis.cloud";

type Reply = { status: number; body?: unknown } | Error;

/** Faux réseau : rend les réponses dans l'ordre, note les appels, avance l'horloge au sommeil. */
function fakeDeps(replies: Reply[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const sleeps: number[] = [];
  let clock = 0;
  const deps: DeviceDeps = {
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const r = replies.shift();
      if (!r) throw new Error("plus de réponse prévue");
      if (r instanceof Error) throw r;
      return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
    }) as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
  };
  return { deps, calls, sleeps };
}

const START: DeviceStart = {
  deviceCode: "dc",
  userCode: "ABCD-EFGH",
  verificationUri: `${BASE}/account/cli`,
  verificationUriComplete: `${BASE}/account/cli?code=ABCD-EFGH`,
  expiresIn: 600,
  interval: 5,
};

test("start envoie le nom de l'appareil et rend le code à afficher", async () => {
  const { deps, calls } = fakeDeps([{ status: 200, body: { ...START } }]);
  const start = await startDeviceFlow(BASE, "gael-pc", deps);
  assert.equal(start.userCode, "ABCD-EFGH");
  assert.equal(calls[0]?.url, `${BASE}/api/cli/device/start`);
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { deviceName: "gael-pc", kind: "HUMAN" });
});

test("start sur une instance qui ne connaît pas le flux (404) oriente vers --token", async () => {
  const { deps } = fakeDeps([{ status: 404 }]);
  await assert.rejects(startDeviceFlow(BASE, "pc", deps), /login --token/);
});

test("start : réseau injoignable → erreur lisible", async () => {
  const { deps } = fakeDeps([new Error("ECONNREFUSED")]);
  await assert.rejects(startDeviceFlow(BASE, "pc", deps), (e: DeviceFlowError) => e.code === "network");
});

test("poll attend tant que c'est en attente, puis rend le jeton", async () => {
  const { deps, calls, sleeps } = fakeDeps([
    { status: 400, body: { error: "authorization_pending" } },
    { status: 400, body: { error: "authorization_pending" } },
    { status: 200, body: { token: "sv_cli_ok", expiresAt: 123, email: "a@b.c" } },
  ]);
  const grant = await pollDeviceFlow(BASE, START, deps);
  assert.deepEqual(grant, { token: "sv_cli_ok", expiresAt: 123, email: "a@b.c" });
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [5000, 5000, 5000]);
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { deviceCode: "dc" });
});

test("slow_down allonge l'intervalle de 5 s", async () => {
  const { deps, sleeps } = fakeDeps([
    { status: 400, body: { error: "slow_down" } },
    { status: 200, body: { token: "sv_cli_ok", expiresAt: 1 } },
  ]);
  await pollDeviceFlow(BASE, START, deps);
  assert.deepEqual(sleeps, [5000, 10000]);
});

test("refus dans le navigateur → access_denied", async () => {
  const { deps } = fakeDeps([{ status: 400, body: { error: "access_denied" } }]);
  await assert.rejects(pollDeviceFlow(BASE, START, deps), (e: DeviceFlowError) => e.code === "access_denied");
});

test("le poll s'arrête à l'expiration du code sans boucler", async () => {
  const pending = Array.from({ length: 200 }, () => ({ status: 400, body: { error: "authorization_pending" } }));
  const { deps, calls } = fakeDeps(pending);
  await assert.rejects(
    pollDeviceFlow(BASE, { ...START, expiresIn: 20, interval: 5 }, deps),
    (e: DeviceFlowError) => e.code === "expired_token",
  );
  assert.equal(calls.length, 4);
});

test("réponse inconnue → erreur, pas de boucle infinie", async () => {
  const { deps } = fakeDeps([{ status: 500, body: null }]);
  await assert.rejects(pollDeviceFlow(BASE, START, deps), /inattendue/);
});

test("revokeSession envoie le Bearer et ne lève jamais", async () => {
  const ok = fakeDeps([{ status: 204 }]);
  assert.equal(await revokeSession(BASE, "sv_cli_x", ok.deps), true);
  assert.equal(
    (ok.calls[0]?.init?.headers as Record<string, string>).authorization,
    "Bearer sv_cli_x",
  );
  const down = fakeDeps([new Error("offline")]);
  assert.equal(await revokeSession(BASE, "sv_cli_x", down.deps), false);
});
