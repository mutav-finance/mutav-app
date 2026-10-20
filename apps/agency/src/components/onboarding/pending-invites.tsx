"use client";

import { useTranslations } from "next-intl";
import { Button } from "@mutav/ui/button";
import { Card, CardContent } from "@mutav/ui/card";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { formatDateBR } from "@mutav/i18n/brazil";
import { usePendingInvites } from "@/components/onboarding/use-pending-invites";

/**
 * Invites addressed to the signed-in user. Rendered above the agency-type
 * choice so an invited person joins their team instead of registering a
 * duplicate agency. Renders nothing when there are none.
 */
export function PendingInvites() {
  const t = useTranslations("onboarding.welcome.invites");
  const vm = usePendingInvites();

  if (!vm.hasInvites) return null;

  return (
    <section className="mb-12 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Eyebrow as="h2" size="xs" className="font-medium">
          {t("title")}
        </Eyebrow>
        <p className="text-text-2 text-sm">{t("description")}</p>
      </div>
      {vm.invites.map((invite) => (
        <Card key={invite.inviteId}>
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <span className="text-text font-medium">
                {invite.agencyName}{" "}
                <span className="text-text-2 font-normal">
                  {t("roleLabel", { role: t(`roles.${invite.role}`) })}
                </span>
              </span>
              <span className="text-text-3 text-xs">
                {invite.invitedByName ? `${t("invitedBy", { name: invite.invitedByName })} · ` : ""}
                {t("expires", { date: formatDateBR(invite.expiresAt) })}
              </span>
            </div>
            <Button
              disabled={vm.acceptingId !== null}
              onClick={() => void vm.accept(invite.inviteId, invite.agencyName)}
            >
              {vm.acceptingId === invite.inviteId ? t("accepting") : t("accept")}
            </Button>
          </CardContent>
        </Card>
      ))}
      <p className="text-text-3 text-xs">{t("or")}</p>
    </section>
  );
}
