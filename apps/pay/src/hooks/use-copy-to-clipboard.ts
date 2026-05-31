"use client";

import * as React from "react";
import { toast } from "sonner";

const COPY_FEEDBACK_DURATION_MS = 1600;

/**
 * Synchronous clipboard write inside the returned `copy` callback — required
 * for iOS Safari transient activation. Toggles `copied` true for 1.6s and
 * fires a Sonner toast with the supplied label. Cleans up the timer on
 * unmount so the state setter never lands on a dead component.
 */
export function useCopyToClipboard(toastLabel: string) {
  const [copied, setCopied] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const copy = React.useCallback(
    (value: string) => {
      navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(toastLabel, { duration: COPY_FEEDBACK_DURATION_MS });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_DURATION_MS);
    },
    [toastLabel],
  );

  return { copied, copy };
}
