"use client";

import * as React from "react";
import { Copy, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";

const CHUNK_SIZES = [14, 14, 14, 13] as const;

export function CopyableAddress({ address }: { address: string }) {
  const t = useTranslations("paymentFlow.copy");
  const tAddr = useTranslations("paymentFlow.address");
  const { copied, copy } = useCopyToClipboard(t("toast"));
  const chunks = React.useMemo(() => chunkInto(address, CHUNK_SIZES), [address]);

  const handleKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      copy(address);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => copy(address)}
      onKeyDown={handleKey}
      aria-label={tAddr("copyLabel")}
      className="group border-border bg-surface hover:border-accent focus-visible:border-accent flex w-full cursor-pointer items-start justify-between gap-3 border p-4 transition-colors duration-150 ease-out focus-visible:outline-none"
    >
      <code
        aria-label={address}
        className="text-text font-mono text-sm leading-6 tracking-[0.02em] tabular-nums"
      >
        {chunks.map((line, i) => (
          <span key={i} className="block">
            {line}
          </span>
        ))}
      </code>
      <span
        aria-hidden="true"
        className="text-text-2 group-hover:text-text inline-flex size-5 shrink-0 items-center justify-center"
      >
        {copied ? (
          <Check className="size-5" strokeWidth={1.25} />
        ) : (
          <Copy className="size-5" strokeWidth={1.25} />
        )}
      </span>
    </div>
  );
}

function chunkInto(input: string, sizes: readonly number[]): string[] {
  const out: string[] = [];
  let cursor = 0;
  for (const size of sizes) {
    out.push(input.slice(cursor, cursor + size));
    cursor += size;
  }
  if (cursor < input.length) {
    out[out.length - 1] = (out[out.length - 1] ?? "") + input.slice(cursor);
  }
  return out;
}
