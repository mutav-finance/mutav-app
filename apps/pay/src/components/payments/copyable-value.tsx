"use client";

import { Copy, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { Mono } from "@mutav/ui/mono";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { cn } from "@mutav/ui/cn";

type Props = {
  display?: React.ReactNode;
  valueToCopy: string;
  label: string;
  className?: string;
};

export function CopyableValue({ display, valueToCopy, label, className }: Props) {
  const t = useTranslations("paymentFlow.copy");
  const { copied, copy } = useCopyToClipboard(t("toast"));

  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <Mono>{display ?? valueToCopy}</Mono>
      <button
        type="button"
        onClick={() => copy(valueToCopy)}
        aria-label={label}
        className="text-text-2 hover:border-border focus-visible:border-accent inline-flex h-11 w-11 items-center justify-center border border-transparent transition-colors duration-150 ease-out focus-visible:outline-none"
      >
        {copied ? (
          <Check aria-hidden="true" className="size-5" strokeWidth={1.25} />
        ) : (
          <Copy aria-hidden="true" className="size-5" strokeWidth={1.25} />
        )}
      </button>
    </div>
  );
}
