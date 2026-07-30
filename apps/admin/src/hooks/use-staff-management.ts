"use client";

import { useState } from "react";
import { useMutation, usePreloadedQuery, type Preloaded } from "convex/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { MutavStaffRole } from "@convex/mutavStaff/domain";

type StaffRow = ReturnType<
  typeof usePreloadedQuery<typeof api.mutavStaff.useCases.listAllStaff>
>[number];

type UseStaffManagementArgs = {
  preloaded: Preloaded<typeof api.mutavStaff.useCases.listAllStaff>;
};

/**
 * View-model hook — holds the /staff page's local state (dialog open flags,
 * form fields, in-flight indicators) and wraps the Convex mutations with
 * toast + error-code translation. The component that consumes it stays pure
 * markup.
 */
export function useStaffManagement({ preloaded }: UseStaffManagementArgs) {
  const rows = usePreloadedQuery(preloaded);
  const t = useTranslations("staff");
  const createStaffRole = useMutation(api.mutavStaff.useCases.createStaffRole);
  const deleteStaffRole = useMutation(api.mutavStaff.useCases.deleteStaffRole);

  const [addOpen, setAddOpen] = useState(false);
  const [addSub, setAddSub] = useState("");
  const [addRole, setAddRole] = useState<MutavStaffRole>("support");
  const [addBusy, setAddBusy] = useState(false);

  const [removeTarget, setRemoveTarget] = useState<{
    auth0Sub: string;
    role: MutavStaffRole;
  } | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  function resetAddForm() {
    setAddSub("");
    setAddRole("support");
  }

  async function submitAdd() {
    const trimmed = addSub.trim();
    if (!trimmed) return;
    setAddBusy(true);
    try {
      const result = await createStaffRole({ auth0Sub: trimmed, role: addRole });
      if (!result.success) {
        toast.error(t(`errors.${result.error.code}`));
        return;
      }
      toast.success(t("toast.createSuccess"));
      setAddOpen(false);
      resetAddForm();
    } catch {
      toast.error(t("errors.unexpected"));
    } finally {
      setAddBusy(false);
    }
  }

  async function confirmRemove() {
    if (!removeTarget) return;
    setRemoveBusy(true);
    try {
      const result = await deleteStaffRole(removeTarget);
      if (!result.success) {
        toast.error(t(`errors.${result.error.code}`));
        return;
      }
      toast.success(t("toast.deleteSuccess"));
      setRemoveTarget(null);
    } catch {
      toast.error(t("errors.unexpected"));
    } finally {
      setRemoveBusy(false);
    }
  }

  return {
    rows,
    add: {
      open: addOpen,
      setOpen: setAddOpen,
      auth0Sub: addSub,
      setAuth0Sub: setAddSub,
      role: addRole,
      setRole: setAddRole,
      busy: addBusy,
      submit: submitAdd,
    },
    remove: {
      target: removeTarget,
      setTarget: setRemoveTarget,
      busy: removeBusy,
      confirm: confirmRemove,
    },
  };
}

export type StaffManagementViewModel = ReturnType<typeof useStaffManagement>;
export type { StaffRow };
