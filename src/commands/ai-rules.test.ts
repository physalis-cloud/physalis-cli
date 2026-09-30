import { test } from "node:test";
import assert from "node:assert/strict";
import { AI_DENY_RULES } from "./ai-rules.js";

test("les règles de refus couvrent ce qui affiche ou écrit des valeurs", () => {
  for (const rule of [
    "Bash(physalis secrets:*)",
    "Bash(physalis export:*)",
    "Bash(physalis pull:*)",
    "Bash(printenv:*)",
    "Read(~/.physalis/**)",
  ]) {
    assert.ok(AI_DENY_RULES.includes(rule), rule);
  }
});

test("physalis run n'est pas bloqué : c'est l'usage prévu pour l'agent", () => {
  assert.ok(!AI_DENY_RULES.some((r) => r.startsWith("Bash(physalis run")));
});
