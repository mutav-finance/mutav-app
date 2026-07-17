/**
 * Brazilian national tax-id checksum validation (CPF for natural persons,
 * CNPJ for legal entities). Server-side source of truth — the client-side
 * copy in `packages/i18n/src/brazil.ts` is a separate boundary (packages
 * must not import convex code).
 */

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function isValidCPF(cpf: string): boolean {
  const d = cpf.replace(/\D/g, "");
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  const n = d.split("").map(Number);
  let s1 = 0;
  for (let i = 0; i < 9; i++) s1 += n[i] * (10 - i);
  const c1 = s1 % 11 < 2 ? 0 : 11 - (s1 % 11);
  if (c1 !== n[9]) return false;
  let s2 = 0;
  for (let i = 0; i < 10; i++) s2 += n[i] * (11 - i);
  const c2 = s2 % 11 < 2 ? 0 : 11 - (s2 % 11);
  return c2 === n[10];
}

export function isValidCNPJ(cnpj: string): boolean {
  const d = cnpj.replace(/\D/g, "");
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;
  const n = d.split("").map(Number);
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const r1 = w1.reduce((acc, w, i) => acc + n[i] * w, 0) % 11;
  if ((r1 < 2 ? 0 : 11 - r1) !== n[12]) return false;
  const r2 = w2.reduce((acc, w, i) => acc + n[i] * w, 0) % 11;
  return (r2 < 2 ? 0 : 11 - r2) === n[13];
}
