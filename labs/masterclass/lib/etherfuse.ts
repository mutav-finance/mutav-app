import { env } from "./env.ts";

export type EtherfuseError = {
  status: number;
  body: unknown;
  message: string;
};

const isJsonResponse = (response: Response): boolean =>
  response.headers.get("content-type")?.includes("application/json") ?? false;

type RequestOptions = {
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, string>;
  body?: unknown;
};

const buildUrl = (baseUrl: string, path: string, query?: Record<string, string>): string => {
  const url = new URL(path, baseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
};

const callEtherfuse = async <TResponse>({
  path,
  method = "GET",
  query,
  body,
}: RequestOptions): Promise<TResponse> => {
  const url = buildUrl(env.etherfuseBaseUrl(), path, query);
  const response = await fetch(url, {
    method,
    headers: {
      // No 'Bearer' prefix — Etherfuse takes the raw key (pitfall called out
      // in the masterclass slide 18).
      Authorization: env.etherfuseApiKey(),
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const parsedBody: unknown = isJsonResponse(response)
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const error: EtherfuseError = {
      status: response.status,
      body: parsedBody,
      message: `Etherfuse ${method} ${path} → HTTP ${response.status}`,
    };
    throw error;
  }
  // External API boundary: trust the caller's TResponse contract.
  return parsedBody as TResponse;
};

export const etherfuse = {
  get: <TResponse>(path: string, query?: Record<string, string>) =>
    callEtherfuse<TResponse>({ path, method: "GET", query }),
  post: <TResponse>(path: string, body?: unknown) =>
    callEtherfuse<TResponse>({ path, method: "POST", body }),
};

const isEtherfuseError = (err: unknown): err is EtherfuseError =>
  typeof err === "object" && err !== null && "status" in err && "body" in err && "message" in err;

export const printEtherfuseError = (err: unknown): void => {
  if (isEtherfuseError(err)) {
    console.error(`✗ ${err.message}`);
    console.error("  body:", JSON.stringify(err.body, null, 2));
    return;
  }
  console.error("✗ Unexpected error:", err);
};
