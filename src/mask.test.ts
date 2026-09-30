import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { Masker, pipeMasked, MASK } from "./mask.js";
import { shouldMask } from "./commands/run.js";

const SECRET = "sk_live_0123456789abcdef";

function maskAll(values: string[], chunks: string[]): string {
  const m = new Masker(values);
  return chunks.map((c) => m.push(c)).join("") + m.flush();
}

test("une valeur affichée en entier est masquée", () => {
  assert.equal(maskAll([SECRET], [`API_KEY=${SECRET}\n`]), `API_KEY=${MASK}\n`);
});

test("une valeur coupée entre deux morceaux est masquée, à chaque point de coupure", () => {
  const line = `token: ${SECRET} fin\n`;
  for (let cut = 1; cut < line.length; cut++) {
    const out = maskAll([SECRET], [line.slice(0, cut), line.slice(cut)]);
    assert.equal(out, `token: ${MASK} fin\n`, `coupure en ${cut}`);
  }
});

test("une valeur livrée caractère par caractère est masquée", () => {
  assert.equal(maskAll([SECRET], [...`[${SECRET}]`]), `[${MASK}]`);
});

test("plusieurs occurrences, plusieurs valeurs", () => {
  const other = "motdepasse-tres-long";
  assert.equal(
    maskAll([SECRET, other], [`${SECRET} ${other} ${SECRET}`]),
    `${MASK} ${MASK} ${MASK}`,
  );
});

test("la plus longue valeur d'abord : une valeur qui en contient une autre est masquée en entier", () => {
  assert.equal(maskAll(["abcdef", "abcdef-ghijkl"], ["abcdef-ghijkl"]), MASK);
});

test("les valeurs trop courtes ne sont pas masquées (sinon « true », « 3000 » partout)", () => {
  const m = new Masker(["true", "3000", "dev"]);
  assert.equal(m.active, false);
  assert.equal(maskAll(["true", "3000"], ["PORT=3000 DEBUG=true"]), "PORT=3000 DEBUG=true");
});

test("sans valeur à masquer, la sortie passe telle quelle", () => {
  assert.equal(maskAll([], ["a", "b\n"]), "ab\n");
});

test("un caractère UTF-8 coupé entre deux paquets d'octets reste intact", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let got = "";
  output.on("data", (b: Buffer) => (got += b.toString("utf8")));
  const done = pipeMasked(input, output, [SECRET], 10);
  const bytes = Buffer.from(`éé ${SECRET} ✓\n`, "utf8");
  for (let i = 0; i < bytes.length; i++) input.write(bytes.subarray(i, i + 1));
  input.end();
  await done;
  assert.equal(got, `éé ${MASK} ✓\n`);
});

test("un vrai processus qui fait printenv ne laisse rien passer", async () => {
  const child = spawn(process.execPath, ["-e", "process.stdout.write(process.env.API_KEY); console.error('err:' + process.env.API_KEY)"], {
    env: { ...process.env, API_KEY: SECRET },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = new PassThrough();
  const err = new PassThrough();
  let o = "";
  let e = "";
  out.on("data", (b: Buffer) => (o += b));
  err.on("data", (b: Buffer) => (e += b));
  await Promise.all([pipeMasked(child.stdout!, out, [SECRET]), pipeMasked(child.stderr!, err, [SECRET])]);
  assert.equal(o, MASK);
  assert.equal(e.trim(), `err:${MASK}`);
});

test("masquage : d'office chez un agent, sur demande sinon, jamais retiré chez un agent", () => {
  assert.equal(shouldMask({}, {}), false);
  assert.equal(shouldMask({ mask: true }, {}), true);
  assert.equal(shouldMask({}, { PHYSALIS_MASK: "1" }), true);
  assert.equal(shouldMask({}, { CLAUDECODE: "1" }), true);
  assert.equal(shouldMask({ mask: false }, { CLAUDECODE: "1" }), true);
});

test("une ligne complète part sans attendre (pas d'entrelacement stdout/stderr)", () => {
  const m = new Masker([SECRET]);
  assert.equal(m.push(`API_KEY=${SECRET}\n`), `API_KEY=${MASK}\n`);
  assert.equal(m.push("début de ligne sans fin"), "");
  assert.equal(m.flush(), "début de ligne sans fin");
});

test("une valeur multi-ligne (clé PEM) coupée entre deux morceaux reste masquée", () => {
  const pem = "-----BEGIN KEY-----\nabcdefghij\n-----END KEY-----";
  const text = `key:\n${pem}\nfin\n`;
  for (let cut = 1; cut < text.length; cut++) {
    assert.equal(maskAll([pem], [text.slice(0, cut), text.slice(cut)]), `key:\n${MASK}\nfin\n`, `coupure en ${cut}`);
  }
});

test("une ligne courte (plus courte que la plus longue valeur) part aussi tout de suite", () => {
  const m = new Masker([SECRET]);
  assert.equal(m.push("ok\n"), "ok\n");
});
