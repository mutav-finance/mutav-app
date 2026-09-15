"use client";

import { PlusIcon } from "lucide-react";
import { Button } from "@mutav/ui/button";
import { Link } from "@mutav/i18n/navigation";

export function CreateGuaranteeButton({ label }: { label: string }) {
  return (
    <Button asChild>
      <Link href="/guarantees/new">
        <PlusIcon data-icon="inline-start" />
        {label}
      </Link>
    </Button>
  );
}
