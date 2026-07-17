import * as React from "react";
import { PencilIcon } from "lucide-react";
import { Button } from "./button";
import { cn } from "./cn";

export function ReviewBlock({
  title,
  children,
  onEdit,
  onSave,
  onCancel,
  editing,
  disabled,
  editLabel,
  saveLabel,
  cancelLabel,
}: {
  title: string;
  children: React.ReactNode;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  editing: boolean;
  disabled: boolean;
  editLabel: string;
  saveLabel: string;
  cancelLabel: string;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-4 transition-opacity",
        disabled && "pointer-events-none opacity-40",
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
          {title}
        </p>
        {!editing && (
          <button
            type="button"
            onClick={onEdit}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
          >
            <PencilIcon className="h-3 w-3" />
            {editLabel}
          </button>
        )}
      </div>
      {children}
      {editing && (
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button size="sm" onClick={onSave}>
            {saveLabel}
          </Button>
        </div>
      )}
    </section>
  );
}
