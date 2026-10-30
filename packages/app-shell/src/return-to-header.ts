import { headers } from "next/headers";
import { RETURN_TO_HEADER, sameOriginPath } from "./return-to";

export async function readReturnToHeader(): Promise<string | null> {
  return sameOriginPath((await headers()).get(RETURN_TO_HEADER));
}
