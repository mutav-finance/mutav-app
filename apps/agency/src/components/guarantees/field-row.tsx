import * as React from "react";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { Item, ItemContent, ItemGroup, ItemTitle } from "@mutav/ui/item";
import { Mono } from "@mutav/ui/mono";
import { cn } from "@mutav/ui/cn";

export const FieldRow = React.memo(function FieldRow({
  label,
  value,
  mono = false,
  className,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  className?: string;
}) {
  const empty = value === "" || value == null;
  return (
    <Item
      className={cn(
        "border-border rounded-none border-x-0 border-t-0 px-6 py-3 last:border-b-0",
        className,
      )}
    >
      <ItemContent>
        <ItemTitle className="text-muted-foreground font-sans text-xs font-medium tracking-[0.01em]">
          {label}
        </ItemTitle>
      </ItemContent>
      <ItemContent>
        <span
          className={cn("text-base-sm", empty ? "text-muted-foreground/60" : "text-foreground")}
        >
          {empty ? "—" : mono ? <Mono>{value}</Mono> : value}
        </span>
      </ItemContent>
    </Item>
  );
});

export function FieldGroupHeader({ children }: { children: React.ReactNode }) {
  return (
    <Eyebrow
      as="div"
      className="border-border bg-secondary text-muted-foreground border-b px-6 py-2 font-medium"
    >
      {children}
    </Eyebrow>
  );
}

export { ItemGroup as FieldGroup };
