import type { ElementType, ReactNode } from "react";
import { cn } from "./cn";

type EyebrowOwnProps<T extends ElementType> = {
  as?: T;
  className?: string;
  children?: ReactNode;
};

export type EyebrowProps<T extends ElementType = "span"> = EyebrowOwnProps<T> &
  Omit<React.ComponentPropsWithoutRef<T>, keyof EyebrowOwnProps<T>>;

export function Eyebrow<T extends ElementType = "span">({
  as,
  className,
  children,
  ...props
}: EyebrowProps<T>) {
  const As = (as ?? "span") as ElementType;
  return (
    <As
      className={cn("text-2xs text-text-2 font-mono tracking-[0.06em] uppercase", className)}
      {...props}
    >
      {children}
    </As>
  );
}
