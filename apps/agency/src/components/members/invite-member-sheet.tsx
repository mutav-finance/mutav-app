"use client";

import { useTranslations } from "next-intl";
import type { AgencyId } from "@convex/agencies/domain";
import { Button } from "@mutav/ui/button";
import { Field } from "@mutav/ui/field";
import { Input } from "@mutav/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mutav/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@mutav/ui/sheet";
import { useInviteMemberSheet } from "@/components/members/use-invite-member-sheet";

type Props = {
  open: boolean;
  agencyId: AgencyId;
  onClose: () => void;
};

export function InviteMemberSheet({ open, agencyId, onClose }: Props) {
  const t = useTranslations("members");
  const vm = useInviteMemberSheet({ agencyId, onClose });

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) vm.close();
      }}
    >
      <SheetContent side="right" className="flex flex-col sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t("inviteSheet.title")}</SheetTitle>
          <SheetDescription>{t("inviteSheet.description")}</SheetDescription>
        </SheetHeader>

        <form
          id="invite-member-form"
          onSubmit={(e) => {
            e.preventDefault();
            void vm.submit();
          }}
          className="flex flex-1 flex-col gap-4 px-4"
        >
          <Field label={t("inviteSheet.email")} error={vm.emailError}>
            <Input
              type="email"
              autoComplete="off"
              autoFocus
              value={vm.email}
              onChange={(e) => vm.setEmail(e.target.value)}
              placeholder={t("inviteSheet.emailPlaceholder")}
            />
          </Field>

          <Field label={t("inviteSheet.role")}>
            <Select value={vm.role} onValueChange={vm.selectRole}>
              <SelectTrigger className="w-full" aria-label={t("inviteSheet.role")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {vm.roles.map((role) => (
                  <SelectItem key={role} value={role}>
                    {t(`roles.${role}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </form>

        <SheetFooter className="flex-row justify-end gap-2 border-t">
          <Button type="button" variant="outline" onClick={vm.close} disabled={vm.submitting}>
            {t("inviteSheet.cancel")}
          </Button>
          <Button type="submit" form="invite-member-form" disabled={vm.submitting}>
            {vm.submitting ? t("inviteSheet.submitting") : t("inviteSheet.submit")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
