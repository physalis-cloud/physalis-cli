// Masquage des secrets dans la sortie de `physalis run` (chantier agent-ssh,
// phase 2e), à la manière d'`op run` (1Password).
//
// Ce que ça couvre : un programme qui AFFICHE une valeur injectée (`printenv`,
// un log de config, une trace d'erreur) — le cas réel d'un agent IA qui lit la
// sortie de ses commandes. Ce que ça ne couvre pas, et c'est à dire : une
// valeur transformée avant d'être affichée (base64, découpée, écrite dans un
// fichier). C'est un filet contre l'accident, pas une barrière.

import { StringDecoder } from "node:string_decoder";

export const MASK = "<masqué par Physalis>";

/**
 * Sous ce seuil, une valeur n'est pas masquée : `1`, `true`, `3000` ou `dev`
 * apparaissent partout dans une sortie normale et la rendraient illisible.
 */
export const MIN_MASKED_LENGTH = 6;

/**
 * Remplace les valeurs dans un flux découpé en morceaux arbitraires. Une valeur
 * peut arriver coupée entre deux morceaux : on retient la fin du tampon (la
 * longueur de la plus longue valeur, moins un caractère) jusqu'au morceau
 * suivant, ou jusqu'à `flush()`.
 */
export class Masker {
  private readonly values: string[];
  private readonly keep: number;
  /** Une valeur sur plusieurs lignes (clé PEM…) interdit de couper aux fins de ligne. */
  private readonly multiline: boolean;
  private pending = "";

  constructor(values: Iterable<string>) {
    // Plus longues d'abord : une valeur qui en contient une autre est masquée
    // en entier, pas en morceaux.
    this.values = [...new Set(values)]
      .filter((v) => v.length >= MIN_MASKED_LENGTH)
      .sort((a, b) => b.length - a.length);
    this.keep = this.values.length ? this.values[0]!.length - 1 : 0;
    this.multiline = this.values.some((v) => v.includes("\n"));
  }

  get active(): boolean {
    return this.values.length > 0;
  }

  private replaceAll(text: string): string {
    let out = text;
    for (const v of this.values) out = out.split(v).join(MASK);
    return out;
  }

  /** Ajoute un morceau ; rend ce qui peut être émis sans risque. */
  push(chunk: string): string {
    const text = this.replaceAll(this.pending + chunk);
    // Sans valeur multi-ligne, une valeur coupée ne peut commencer qu'APRÈS le
    // dernier retour à la ligne : tout ce qui précède part tout de suite. Sans
    // ça, la fin d'une ligne de stdout restait en attente pendant que stderr
    // s'affichait, et les deux s'entrelaçaient au milieu d'une ligne.
    let cut = Math.max(0, text.length - this.keep);
    if (!this.multiline) cut = Math.max(cut, text.lastIndexOf("\n") + 1);
    this.pending = text.slice(cut);
    return text.slice(0, cut);
  }

  /** Fin du flux (ou pause) : émet le reste. */
  flush(): string {
    const text = this.replaceAll(this.pending);
    this.pending = "";
    return text;
  }
}

/**
 * Branche un flux de sortie de l'enfant sur une sortie du parent, masqué.
 * Le tampon est vidé après `idleMs` sans nouvelle donnée, pour qu'une invite
 * (« Mot de passe : ») s'affiche sans attendre la fin du programme.
 */
export function pipeMasked(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
  values: Iterable<string>,
  idleMs = 100,
): Promise<void> {
  const masker = new Masker(values);
  const decoder = new StringDecoder("utf8");
  let timer: NodeJS.Timeout | undefined;

  const emit = (s: string) => {
    if (s) output.write(s);
  };

  return new Promise((resolve) => {
    input.on("data", (buf: Buffer) => {
      emit(masker.push(decoder.write(buf)));
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => emit(masker.flush()), idleMs);
    });
    input.on("end", () => {
      if (timer) clearTimeout(timer);
      emit(masker.push(decoder.end()));
      emit(masker.flush());
      resolve();
    });
  });
}
