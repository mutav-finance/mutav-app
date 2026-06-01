"use client";

import { PlusIcon } from "lucide-react";
import { Button } from "@mutav/ui/button";
import { Link } from "@/i18n/navigation";

export function CreateContractButton({ label }: { label: string }) {
  return (
    <Button asChild size="sm">
      <Link href="/contracts/new">
        <PlusIcon data-icon="inline-start" />
        {label}
      </Link>
    </Button>
  );
}
