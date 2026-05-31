"use client";

import * as React from "react";
import { Copy, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";

type Props = {
  uri: string;
  label: string;
};

/**
 * Stellar SEP-7 payment URI rendered as a multi-line code block, broken at
 * query-string boundaries for legibility. Whole block is the tap target
 * (Enter/Space keyboard-activatable); a single click copies the entire
 * unformatted URI to clipboard.
 */
export function CopyableSep7Link({ uri, label }: Props) {
  const t = useTranslations("paymentFlow.copy");
  const { copied, copy } = useCopyToClipboard(t("toast"));
  const lines = React.useMemo(() => splitSep7Lines(uri), [uri]);

  const handleKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      copy(uri);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => copy(uri)}
      onKeyDown={handleKey}
      aria-label={label}
      className="group border-border bg-surface hover:border-accent focus-visible:border-accent flex w-full cursor-pointer items-start justify-between gap-3 border p-4 transition-colors duration-150 ease-out focus-visible:outline-none"
    >
      <code
        aria-label={uri}
        className="text-text font-mono text-xs leading-5 tracking-[0.02em] break-all"
      >
        {lines.map((line, i) => (
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

function splitSep7Lines(uri: string): string[] {
  const queryIndex = uri.indexOf("?");
  if (queryIndex === -1) return [uri];
  const head = uri.slice(0, queryIndex + 1);
  const params = uri.slice(queryIndex + 1).split("&");
  return [head, ...params.map((p, i) => (i === 0 ? p : `&${p}`))];
}
