"use client";

import { useTranslations } from "next-intl";
import { CheckIcon, CopyIcon } from "lucide-react";
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
import type { SentInvite } from "@/components/members/use-invite-member-sheet";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";

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
        {vm.sent ? (
          <InviteSentPanel sent={vm.sent} onDone={vm.close} />
        ) : (
          <>
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
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function InviteSentPanel({ sent, onDone }: { sent: SentInvite; onDone: () => void }) {
  const t = useTranslations("members.inviteSheet.sent");
  const { copied, copy } = useCopyToClipboard(t("linkCopied"));

  return (
    <>
      <SheetHeader>
        <SheetTitle>{t("title")}</SheetTitle>
        <SheetDescription>
          {sent.emailQueued
            ? t("emailed", { email: sent.email })
            : t("notEmailed", { email: sent.email })}
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-4 px-4">
        <Field label={t("linkLabel")}>
          <div className="flex gap-2">
            <Input readOnly value={sent.link} onFocus={(e) => e.currentTarget.select()} />
            <Button type="button" variant="outline" onClick={() => copy(sent.link)}>
              {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
              {t("copy")}
            </Button>
          </div>
        </Field>
        <p className="text-muted-foreground text-sm">{t("linkHint", { email: sent.email })}</p>
      </div>

      <SheetFooter className="flex-row justify-end gap-2 border-t">
        <Button type="button" onClick={onDone}>
          {t("done")}
        </Button>
      </SheetFooter>
    </>
  );
}
