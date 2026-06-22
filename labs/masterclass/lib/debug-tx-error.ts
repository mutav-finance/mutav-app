type HorizonErrorBody = {
  extras?: {
    result_codes?: unknown;
    envelope_xdr?: string;
    result_xdr?: string;
  };
};

type AxiosLikeError = {
  response?: { data?: HorizonErrorBody };
  message?: string;
};

const isAxiosLikeError = (err: unknown): err is AxiosLikeError =>
  typeof err === "object" && err !== null && "response" in err;

export const printHorizonError = (err: unknown): void => {
  if (isAxiosLikeError(err)) {
    const data = err.response?.data;
    console.error("✗ Horizon rejected the tx");
    console.error("  result_codes :", JSON.stringify(data?.extras?.result_codes, null, 2));
    console.error("  envelope_xdr :", data?.extras?.envelope_xdr);
    console.error("  result_xdr   :", data?.extras?.result_xdr);
    return;
  }
  console.error("✗ Unexpected error:", err);
};
