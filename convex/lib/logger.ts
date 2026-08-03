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
  { label: "CNPJ", pattern: /(?<!\d)\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?!\d)/g },
  { label: "CPF", pattern: /(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g },
  // Two shapes, because an undelimited digit run is ambiguous. A run with no
  // separator only counts as a phone when it carries the 55 country code
  // (the vendor integrations send E.164 with the + stripped), which keeps a
  // bare 10-digit unix-seconds stamp or numeric external id out of the match.
  // Without the country code a separator — parentheses, space or dash — is
  // required. A bare 11-digit run is left to the CPF rule above.
  {
    label: "PHONE",
    pattern:
      /(?<!\d)(?:\+?55[\s-]?\(?[1-9]\d\)?[\s-]?9?\d{4}[\s-]?\d{4}|(?:\([1-9]\d\)|[1-9]\d[\s-])\s?9?\d{4}[\s-]?\d{4})(?!\d)/g,
  },
];

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

  if (value instanceof Error) {
    return { name: value.name, message: redactPii(value.message) };
  }

  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return items.map((item) => redactAtDepth(item, depth + 1));
  }

  const entries: [string, unknown][] = Object.entries(value);
  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of entries) {
    redacted[key] = redactAtDepth(entry, depth + 1);
  }
  return redacted;
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
