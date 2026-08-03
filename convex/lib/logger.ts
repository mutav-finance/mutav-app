/**
 * Console logging with personal data stripped out (LGPD-14).
 *
 * Convex ships everything written to `console.*` to the deployment's
 * function log, which is US-hosted and outside any retention policy, so
 * every log line goes through pattern redaction before it is emitted.
 * Use `logInfo` / `logWarn` / `logError` instead of `console.*` in
 * `convex/**`, and put anything variable in the `context` argument so it
 * is walked recursively rather than pre-interpolated into the message.
 */

type RedactionRule = {
  readonly label: string;
  readonly pattern: RegExp;
};

/**
 * Order is load-bearing and fail-closed: a bare 11-digit run is both a
 * valid CPF and a valid mobile number, so CPF matches first and the
 * value is redacted under that label. CNPJ precedes CPF for the same
 * reason (its first 11 digits look like a CPF), and e-mail precedes both
 * because a local part may be all digits.
 */
const REDACTION_RULES: readonly RedactionRule[] = [
  { label: "EMAIL", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  {
    label: "CNPJ",
    pattern: /(?<![0-9A-Za-z])\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?![0-9A-Za-z])/g,
  },
  { label: "CPF", pattern: /(?<![0-9A-Za-z])\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?![0-9A-Za-z])/g },
  // Two shapes, because an undelimited digit run is ambiguous. A run with no
  // separator only counts as a phone when it carries the 55 country code
  // (the vendor integrations send E.164 with the + stripped), which keeps a
  // bare 10-digit unix-seconds stamp or numeric external id out of the match.
  // Without the country code a separator — parentheses, space or dash — is
  // required. A bare 11-digit run is left to the CPF rule above.
  {
    label: "PHONE",
    pattern:
      /(?<![0-9A-Za-z])(?:\+?55[\s-]?\(?[1-9]\d\)?[\s-]?9?\d{4}[\s-]?\d{4}|(?:\([1-9]\d\)|[1-9]\d[\s-])\s?9?\d{4}[\s-]?\d{4})(?![0-9A-Za-z])/g,
  },
  { label: "CEP", pattern: /(?<![0-9A-Za-z])\d{5}-\d{3}(?![0-9A-Za-z])/g },
];

/**
 * Field names whose VALUE is personal data regardless of its shape.
 *
 * This is the primary defence, not a supplement to the patterns above. A
 * regex can recognise a CPF because a CPF has a shape; it cannot recognise
 * "Joao da Silva", a birth date, a street address or an account number,
 * because those are shapeless — a name is just a string. The only signal
 * available is the key the value arrived under, so a matching key redacts
 * the whole subtree without inspecting it.
 *
 * `name` is included deliberately despite being broad. `agencies.name` is a
 * company name, and a company name is a person's name whenever the agency is
 * an empresário individual or MEI. `Error.name` is unaffected because errors
 * are shaped explicitly below rather than walked as plain objects.
 */
const PII_KEY_PATTERN =
  /^(?:e-?mails?|cpf|cnpj|tax_?id|document|documento|phones?|telefone|celular|whatsapp|full_?names?|names?|nome|birth_?date|born|nascimento|cep|zip_?code|postal_?code|address|endereco|street.*|logradouro|bairro|neighborhood|complement(?:o)?|account_?number|account_?holder.*|holder_?name|agencia|pix_?key|rg|creci|representante.*|contact_?cpf)$/i;

const FIELD_PLACEHOLDER = "[REDACTED:FIELD]";

const MAX_REDACTION_DEPTH = 6;
const DEPTH_PLACEHOLDER = "[REDACTED:DEPTH]";

export function redactPii(input: string): string {
  let output = input;
  for (const rule of REDACTION_RULES) {
    output = output.replace(rule.pattern, `[REDACTED:${rule.label}]`);
  }
  return output;
}

export function redactForLog(value: unknown): unknown {
  return redactAtDepth(value, 0);
}

function redactAtDepth(value: unknown, depth: number): unknown {
  if (typeof value === "string") return redactPii(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_REDACTION_DEPTH) return DEPTH_PLACEHOLDER;

  // Dates, Maps and Sets have no own enumerable properties, so the
  // `Object.entries` walk below renders every one of them as `{}` — the value
  // disappears with no indication that anything was elided. Shape them before
  // that happens.
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([key, entry]) => [
        redactPii(String(key)),
        redactKeyedValue(String(key), entry, depth + 1),
      ]),
    );
  }
  if (value instanceof Set) {
    return [...value.values()].map((item) => redactAtDepth(item, depth + 1));
  }

  // `stack` and `cause` are the difference between a debuggable error and a
  // one-line message with no origin, and `ConvexError.data` carries the error
  // code the whole convention rests on. Redact them; do not drop them.
  if (value instanceof Error) {
    const shaped: Record<string, unknown> = {
      name: value.name,
      message: redactPii(value.message),
    };
    if (typeof value.stack === "string") shaped.stack = redactPii(value.stack);
    if (value.cause !== undefined) shaped.cause = redactAtDepth(value.cause, depth + 1);
    const data: unknown = (value as { data?: unknown }).data;
    if (data !== undefined) shaped.data = redactAtDepth(data, depth + 1);
    return shaped;
  }

  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return items.map((item) => redactAtDepth(item, depth + 1));
  }

  const entries: [string, unknown][] = Object.entries(value);
  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of entries) {
    // The key is redacted too: a map keyed by e-mail address (a dedupe set, a
    // per-recipient result map, a vendor response keyed by address) leaks the
    // identifier wholesale even when every value is harmless.
    redacted[redactPii(key)] = redactKeyedValue(key, entry, depth + 1);
  }
  return redacted;
}

function redactKeyedValue(key: string, entry: unknown, depth: number): unknown {
  if (PII_KEY_PATTERN.test(key)) return FIELD_PLACEHOLDER;
  return redactAtDepth(entry, depth);
}

export function logInfo(message: string, context?: unknown): void {
  if (context === undefined) {
    console.info(redactPii(message));
    return;
  }
  console.info(redactPii(message), redactForLog(context));
}

export function logWarn(message: string, context?: unknown): void {
  if (context === undefined) {
    console.warn(redactPii(message));
    return;
  }
  console.warn(redactPii(message), redactForLog(context));
}

export function logError(message: string, context?: unknown): void {
  if (context === undefined) {
    console.error(redactPii(message));
    return;
  }
  console.error(redactPii(message), redactForLog(context));
}
