export function getResendApiKey(): string {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  return key;
}

export function getResendFromEmail(): string {
  return process.env.RESEND_FROM_EMAIL ?? "SGR <noreply@sgr.com.br>";
}

export function getAppUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}

export function getWhatsAppApiUrl(): string | null {
  return process.env.WHATSAPP_API_URL ?? null;
}

export function getWhatsAppApiKey(): string | null {
  return process.env.WHATSAPP_API_KEY ?? null;
}
