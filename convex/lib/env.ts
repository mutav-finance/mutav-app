export function getResendApiKey(): string {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  return key;
}

export function getResendFromEmail(): string {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) throw new Error("RESEND_FROM_EMAIL is not set");
  return from;
}

export function getAppUrl(): string {
  const url = process.env.APP_URL;
  if (!url) throw new Error("APP_URL is not set");
  return url;
}

export function getWhatsAppApiUrl(): string | null {
  return process.env.WHATSAPP_API_URL ?? null;
}

export function getWhatsAppApiKey(): string | null {
  return process.env.WHATSAPP_API_KEY ?? null;
}
