import { test } from "node:test";
import assert from "node:assert/strict";
import type { spawnSync } from "node:child_process";
import { detectKeychain, KEYCHAIN_SERVICE } from "./keychain.js";

type Call = { cmd: string; args: string[]; opts: Record<string, unknown> };

/** Faux lanceur : les commandes listées existent, `lookup`/`find` rendent `stored`. */
function fakeRun(existing: string[], stored = "sv_cli_x") {
  const calls: Call[] = [];
  const run = ((cmd: string, args: string[], opts: Record<string, unknown>) => {
    calls.push({ cmd, args, opts });
    if (!existing.includes(cmd)) return { error: new Error("ENOENT"), status: null, stdout: "" };
    const reading = args[0] === "lookup" || args[0] === "find-generic-password";
    return { status: 0, stdout: reading ? `${stored}\n` : "" };
  }) as unknown as typeof spawnSync;
  return { run, calls };
}

const DBUS = { DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus" };

test("Linux : Secret Service si secret-tool et une session D-Bus existent", () => {
  assert.ok(detectKeychain("linux", DBUS, fakeRun(["secret-tool"]).run));
  assert.equal(detectKeychain("linux", {}, fakeRun(["secret-tool"]).run), null, "sans D-Bus (serveur)");
  assert.equal(detectKeychain("linux", DBUS, fakeRun([]).run), null, "sans secret-tool (WSL)");
});

test("Linux : le jeton passe par l'entrée standard, JAMAIS en argument (ps)", () => {
  const { run, calls } = fakeRun(["secret-tool"]);
  const kc = detectKeychain("linux", DBUS, run)!;
  assert.equal(kc.set("human:https://a", "sv_cli_secret"), true);
  const store = calls.find((c) => c.args[0] === "store")!;
  assert.equal(store.opts.input, "sv_cli_secret");
  assert.equal(store.args.includes("sv_cli_secret"), false);
  assert.deepEqual(store.args.slice(-4), ["service", KEYCHAIN_SERVICE, "account", "human:https://a"]);
});

test("Linux : relecture sans le retour à la ligne final", () => {
  const kc = detectKeychain("linux", DBUS, fakeRun(["secret-tool"], "sv_cli_lu").run)!;
  assert.equal(kc.get("human:https://a"), "sv_cli_lu");
});

test("macOS : trousseau via `security`", () => {
  const { run, calls } = fakeRun(["security"], "sv_cli_mac");
  const kc = detectKeychain("darwin", {}, run)!;
  assert.equal(kc.get("human:https://a"), "sv_cli_mac");
  kc.delete("human:https://a");
  assert.ok(calls.some((c) => c.args[0] === "delete-generic-password"));
});

test("Windows et PHYSALIS_NO_KEYCHAIN=1 : repli sur le fichier", () => {
  assert.equal(detectKeychain("win32", {}, fakeRun(["security", "secret-tool"]).run), null);
  assert.equal(detectKeychain("linux", { ...DBUS, PHYSALIS_NO_KEYCHAIN: "1" }, fakeRun(["secret-tool"]).run), null);
});

test("un secret absent se lit comme null, pas comme une chaîne vide", () => {
  const run = (() => ({ status: 1, stdout: "" })) as unknown as typeof spawnSync;
  const kc = detectKeychain("linux", DBUS, ((c: string, a: string[], o: unknown) =>
    a[0] === "--help" ? { status: 0 } : (run as unknown as (...x: unknown[]) => unknown)(c, a, o)) as unknown as typeof spawnSync)!;
  assert.equal(kc.get("human:https://a"), null);
});
