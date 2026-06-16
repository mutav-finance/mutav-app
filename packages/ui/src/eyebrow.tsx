import type { ElementType, ReactNode } from "react";
import { cn } from "./cn";

export type EyebrowSize = "2xs" | "xs";
export type EyebrowTone = "default" | "muted" | "subtle";

const sizeClass: Record<EyebrowSize, string> = {
  "2xs": "text-2xs",
  xs: "text-xs",
};

const toneClass: Record<EyebrowTone, string> = {
  default: "text-foreground",
  muted: "text-muted-foreground",
  subtle: "text-text-3",
};

type EyebrowOwnProps<T extends ElementType> = {
  as?: T;
  size?: EyebrowSize;
  tone?: EyebrowTone;
  className?: string;
  children?: ReactNode;
};

export type EyebrowProps<T extends ElementType = "span"> = EyebrowOwnProps<T> &
  Omit<React.ComponentPropsWithoutRef<T>, keyof EyebrowOwnProps<T>>;

export function Eyebrow<T extends ElementType = "span">({
  as,
  size = "2xs",
  tone = "muted",
  className,
  children,
  ...props
}: EyebrowProps<T>) {
  const As = (as ?? "span") as ElementType;
  return (
    <As
      className={cn(
        "font-mono tracking-[0.06em] uppercase",
        sizeClass[size],
        toneClass[tone],
        className,
      )}
      {...props}
    >
      {children}
    </As>
  );
}
