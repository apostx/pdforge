import type { Signature } from './SignatureProvider';

/** Signatures with the same name are variants of one signature (say, several scanned samples). */
export interface SignatureGroup {
  name: string;
  variants: Signature[];
}

export function groupSignatures(signatures: Signature[]): SignatureGroup[] {
  const groups = new Map<string, Signature[]>();
  for (const signature of signatures) {
    const name = signature.name.trim();
    groups.set(name, [...(groups.get(name) ?? []), signature]);
  }
  // signatures come oldest first, so groups keep the order they were started in
  return [...groups].map(([name, variants]) => ({ name, variants }));
}

/**
 * Picks the variant at position `index` of a placement run, starting from `offset`, so that
 * consecutive pages get different variants and nothing looks copied.
 */
export function variantAt(variants: Signature[], offset: number, index: number): Signature {
  return variants[(offset + index) % variants.length];
}

// Placing a signature by hand (in the editor) hands out the variants in turn too.
const turns = new Map<string, number>();

export function nextVariant(group: SignatureGroup): Signature {
  const turn = turns.get(group.name) ?? Math.floor(Math.random() * group.variants.length);
  turns.set(group.name, turn + 1);
  return variantAt(group.variants, turn, 0);
}
