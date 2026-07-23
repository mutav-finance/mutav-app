"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { AgencyId } from "@convex/agencies/domain";
import { Button } from "@mutav/ui/button";
import { EditField } from "@mutav/ui/edit-field";
import { Input } from "@mutav/ui/input";
import { LockedDisplay } from "@mutav/ui/locked-display";
import { ReviewBlock } from "@mutav/ui/review-block";
import { ReviewRow } from "@mutav/ui/review-row";
import { ToggleGroup, ToggleGroupItem } from "@mutav/ui/toggle-group";
import {
  isPropertyKind,
  parseBRLInput,
  patchBlockDraft,
  startBlockEdit,
  validateWizard,
  WIZARD_VIEWING,
  type DraftWizardData,
  type EditingState,
  type ReviewBlockKind,
} from "@/lib/contracts/wizard";
import { formatBRLCents } from "@/lib/contracts/format";
import { priceContract, splitCommission, DEFAULT_PRICING_TABLE } from "@convex/contracts/pricing";

type Props = {
  data: DraftWizardData;
  agencyId: AgencyId;
  onChange: (patch: Partial<DraftWizardData>) => void;
  onComplete: (publicId: string) => void;
  onBack: () => void;
};

type MissingFields = Set<string>;

export function WizardStep4({ data, agencyId, onChange, onComplete, onBack }: Props) {
  const t = useTranslations("contractNew");
  const createContract = useMutation(api.contracts.useCases.create);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [missing, setMissing] = React.useState<MissingFields>(new Set());
  const [editing, setEditing] = React.useState<EditingState>(WIZARD_VIEWING);

  const priceableTier = data.scoreTier && data.scoreTier !== "negado" ? data.scoreTier : null;
  const preview =
    priceableTier && data.rentCents > 0
      ? priceContract({
          rentCents: data.rentCents,
          condoCents: data.condoCents,
          otherFeesCents: data.otherFeesCents,
          tier: priceableTier,
        })
      : null;
  const commission = preview ? splitCommission(preview.feeCents) : null;

  const totalRentCents = data.rentCents + data.condoCents + data.otherFeesCents;

  function startEdit(block: ReviewBlockKind) {
    setEditing(startBlockEdit(block, data));
  }

  function patchDraft(patch: Partial<DraftWizardData>) {
    setEditing((s) => patchBlockDraft(s, patch));
  }

  function saveEdit() {
    if (editing.kind !== "editing") return;
    onChange(editing.draft);
    setEditing(WIZARD_VIEWING);
  }

  function cancelEdit() {
    setEditing(WIZARD_VIEWING);
  }

  const handleSubmit = async () => {
    const validation = validateWizard(data);
    if (!validation.success) {
      const invalidFields = new Set<string>();
      for (const error of validation.error) {
        if (error.field) invalidFields.add(error.field);
      }
      setMissing(invalidFields);
      const firstCode = validation.error[0]?.code;
      toast.error(firstCode ? t(`validation.${firstCode}`) : t("review.missingFields"));
      return;
    }
    setMissing(new Set());
    const { tenant, ...validated } = validation.data;

    // create() takes a flat tenant wire shape (cpf + birthDate always present,
    // cnpj optional) and normalizes it into the registry. The validated tenant
    // is a pf/pj union — flatten it here, discriminating on entityType so the
    // adaptation stays cast-free. A pj carries no cpf/birthDate, so send "".
    const tenantWire =
      tenant.entityType === "pj"
        ? {
            entityType: tenant.entityType,
            fullName: tenant.fullName,
            cpf: "",
            cnpj: tenant.cnpj,
            birthDate: "",
            email: tenant.email,
            phone: tenant.phone,
            score: tenant.score,
          }
        : {
            entityType: tenant.entityType,
            fullName: tenant.fullName,
            cpf: tenant.cpf,
            cnpj: undefined,
            birthDate: tenant.birthDate,
            email: tenant.email,
            phone: tenant.phone,
            score: tenant.score,
          };

    setIsSubmitting(true);
    let result: Awaited<ReturnType<typeof createContract>>;
    try {
      result = await createContract({
        agencyId,
        property: {
          cep: validated.cep,
          streetAndNumber: `${validated.street}, ${validated.addressNumber}`,
          neighborhood: validated.neighborhood,
          cityUF: `${validated.city} / ${validated.uf}`,
        },
        optional: { complement: validated.complement, tag: "", description: "" },
        propertyKind: validated.propertyKind,
        rentCents: validated.rentCents,
        condoCents: validated.condoCents,
        otherFeesCents: validated.otherFeesCents,
        tenant: tenantWire,
      });
    } catch {
      // Transport-level failures only (arg-validator/auth throw at the wire);
      // domain failures arrive as Result codes below.
      toast.error(t("review.errorToast"));
      setIsSubmitting(false);
      return;
    }

    if (!result.success) {
      toast.error(t(`review.errors.${result.error.code}`));
      setIsSubmitting(false);
      return;
    }
    onComplete(result.data.publicId);
  };

  const missingText = (field: keyof DraftWizardData) =>
    missing.has(field) ? t("validation.required") : undefined;
  const isEditing = editing.kind === "editing";
  const editingProperty = editing.kind === "editing" && editing.block === "property";
  const editingRental = editing.kind === "editing" && editing.block === "rental";
  const editingTenant = editing.kind === "editing" && editing.block === "tenant";

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{t("review.heading")}</h2>

      {/* Bloco 1 — Dados do Imóvel */}
      <ReviewBlock
        title={t("review.propertySection")}
        onEdit={() => startEdit("property")}
        editing={editingProperty}
        disabled={isEditing && !editingProperty}
        onSave={saveEdit}
        onCancel={cancelEdit}
        editLabel={t("review.editBlock")}
        saveLabel={t("review.saveBlock")}
        cancelLabel={t("review.cancelBlock")}
      >
        {editingProperty ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <EditField label={t("property.kindLabel")} className="sm:col-span-2">
              <ToggleGroup
                type="single"
                value={editing.draft.propertyKind}
                onValueChange={(v) => {
                  if (!isPropertyKind(v)) return;
                  patchDraft({ propertyKind: v });
                }}
                variant="outline"
                spacing={2}
              >
                <ToggleGroupItem value="residencial">{t("property.residencial")}</ToggleGroupItem>
                <ToggleGroupItem value="comercial">{t("property.comercial")}</ToggleGroupItem>
              </ToggleGroup>
            </EditField>
            <EditField label={t("property.cep")}>
              <Input
                maxLength={9}
                value={editing.draft.cep}
                onChange={(e) => patchDraft({ cep: e.target.value })}
              />
            </EditField>
            <EditField label={t("property.neighborhood")}>
              <Input
                value={editing.draft.neighborhood}
                onChange={(e) => patchDraft({ neighborhood: e.target.value })}
              />
            </EditField>
            <EditField label={t("property.street")} className="sm:col-span-2">
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Input
                  value={editing.draft.street}
                  onChange={(e) => patchDraft({ street: e.target.value })}
                />
                <Input
                  className="w-24"
                  value={editing.draft.addressNumber}
                  onChange={(e) => patchDraft({ addressNumber: e.target.value })}
                  placeholder={t("property.addressNumber")}
                />
              </div>
            </EditField>
            <EditField label={t("property.city")}>
              <Input
                value={editing.draft.city}
                onChange={(e) => patchDraft({ city: e.target.value })}
              />
            </EditField>
            <EditField label={t("property.uf")}>
              <Input
                maxLength={2}
                className="uppercase"
                value={editing.draft.uf}
                onChange={(e) => patchDraft({ uf: e.target.value.toUpperCase() })}
              />
            </EditField>
            <EditField label={t("property.complement")} className="sm:col-span-2">
              <Input
                value={editing.draft.complement}
                onChange={(e) => patchDraft({ complement: e.target.value })}
              />
            </EditField>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
            <ReviewRow
              label={t("property.kindLabel")}
              value={
                data.propertyKind === "residencial"
                  ? t("property.residencial")
                  : data.propertyKind === "comercial"
                    ? t("property.comercial")
                    : ""
              }
              missing={missingText("propertyKind")}
            />
            <ReviewRow
              label={t("property.cep")}
              value={data.cep}
              mono
              missing={missingText("cep")}
            />
            <ReviewRow
              label={t("property.street")}
              value={data.street}
              missing={missingText("street")}
              className="col-span-2"
            />
            <ReviewRow
              label={t("property.addressNumber")}
              value={data.addressNumber}
              missing={missingText("addressNumber")}
            />
            <ReviewRow
              label={t("property.neighborhood")}
              value={data.neighborhood}
              missing={missingText("neighborhood")}
            />
            <ReviewRow label={t("property.city")} value={data.city} missing={missingText("city")} />
            <ReviewRow label={t("property.uf")} value={data.uf} missing={missingText("uf")} />
            {data.complement && (
              <ReviewRow
                label={t("property.complement")}
                value={data.complement}
                className="col-span-2"
              />
            )}
          </div>
        )}
      </ReviewBlock>

      {/* Bloco 2 — Dados de Locação */}
      <ReviewBlock
        title={t("review.rentalSection")}
        onEdit={() => startEdit("rental")}
        editing={editingRental}
        disabled={isEditing && !editingRental}
        onSave={saveEdit}
        onCancel={cancelEdit}
        editLabel={t("review.editBlock")}
        saveLabel={t("review.saveBlock")}
        cancelLabel={t("review.cancelBlock")}
      >
        {editingRental ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <EditField label={t("rent.rent")}>
              <Input
                placeholder="R$ 0,00"
                defaultValue={
                  data.rentCents ? (data.rentCents / 100).toFixed(2).replace(".", ",") : ""
                }
                onBlur={(e) => patchDraft({ rentCents: parseBRLInput(e.target.value) })}
              />
            </EditField>
            <EditField label={t("rent.condo")}>
              <Input
                placeholder="R$ 0,00"
                defaultValue={
                  data.condoCents ? (data.condoCents / 100).toFixed(2).replace(".", ",") : ""
                }
                onBlur={(e) => patchDraft({ condoCents: parseBRLInput(e.target.value) })}
              />
            </EditField>
            <EditField label={t("rent.otherFees")}>
              <Input
                placeholder="R$ 0,00"
                defaultValue={
                  data.otherFeesCents
                    ? (data.otherFeesCents / 100).toFixed(2).replace(".", ",")
                    : ""
                }
                onBlur={(e) => patchDraft({ otherFeesCents: parseBRLInput(e.target.value) })}
              />
            </EditField>
          </div>
        ) : (
          <div className="flex gap-8">
            <div className="flex flex-1 flex-col gap-0.5">
              <ReviewRow
                label={t("rent.rent")}
                value={formatBRLCents(data.rentCents)}
                mono
                missing={missingText("rentCents")}
              />
              {data.otherFeesCents > 0 && (
                <ReviewRow
                  label={t("rent.otherFees")}
                  value={formatBRLCents(data.otherFeesCents)}
                  mono
                />
              )}
            </div>
            <div className="flex flex-1 flex-col gap-0.5">
              {data.condoCents > 0 && (
                <ReviewRow label={t("rent.condo")} value={formatBRLCents(data.condoCents)} mono />
              )}
              <ReviewRow
                label={t("rent.total")}
                value={formatBRLCents(totalRentCents)}
                mono
                highlight
              />
            </div>
          </div>
        )}
      </ReviewBlock>

      {/* Bloco 3 — Dados do Inquilino */}
      <ReviewBlock
        title={t("review.tenantSection")}
        onEdit={() => startEdit("tenant")}
        editing={editingTenant}
        disabled={isEditing && !editingTenant}
        onSave={saveEdit}
        onCancel={cancelEdit}
        editLabel={t("review.editBlock")}
        saveLabel={t("review.saveBlock")}
        cancelLabel={t("review.cancelBlock")}
      >
        {editingTenant ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LockedDisplay
              label={data.entityType === "pj" ? t("tenant.companyName") : t("tenant.fullName")}
              value={data.fullName}
              className="sm:col-span-2"
            />
            <LockedDisplay
              label={data.entityType === "pj" ? t("tenant.cnpj") : t("tenant.cpf")}
              value={data.entityType === "pj" ? data.cnpj : data.cpf}
            />
            {data.entityType === "pf" && (
              <EditField label={t("tenant.birthDate")}>
                <Input
                  type="date"
                  value={editing.draft.birthDate}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => patchDraft({ birthDate: e.target.value })}
                />
              </EditField>
            )}
            <EditField label={t("tenant.email")}>
              <Input
                type="email"
                value={editing.draft.email}
                onChange={(e) => patchDraft({ email: e.target.value })}
              />
            </EditField>
            <EditField label={t("tenant.phone")}>
              <Input
                value={editing.draft.phone}
                onChange={(e) => patchDraft({ phone: e.target.value })}
              />
            </EditField>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
            <ReviewRow
              label={data.entityType === "pj" ? t("tenant.companyName") : t("tenant.fullName")}
              value={data.fullName}
              missing={missingText("fullName")}
              className="col-span-2"
            />
            {data.entityType === "pf" && (
              <ReviewRow label={t("tenant.cpf")} value={data.cpf} mono />
            )}
            {data.entityType === "pj" && (
              <ReviewRow label={t("tenant.cnpj")} value={data.cnpj} mono />
            )}
            {data.entityType === "pf" && (
              <ReviewRow
                label={t("tenant.birthDate")}
                value={data.birthDate}
                mono
                missing={missingText("birthDate")}
              />
            )}
            <ReviewRow
              label={t("tenant.email")}
              value={data.email}
              missing={missingText("email")}
            />
            <ReviewRow
              label={t("tenant.phone")}
              value={data.phone}
              mono
              missing={missingText("phone")}
            />
            {data.score !== null && data.scoreTier !== null && (
              <ReviewRow
                label={t("review.score")}
                value={`${data.score} (${data.scoreTier})`}
                mono
              />
            )}
          </div>
        )}
      </ReviewBlock>

      {/* Bloco 4 — Dados do Plano */}
      <section className="flex flex-col gap-2 rounded-lg border p-4">
        <p className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
          {t("review.planSection")}
        </p>
        <div className="flex gap-8">
          <div className="flex flex-1 flex-col gap-0.5">
            <ReviewRow
              label={t("coverage.rentMultiplierLabel")}
              value={`${DEFAULT_PRICING_TABLE.coverageCeilingMultiplier}x`}
              mono
            />
            <ReviewRow
              label={t("coverage.exitCostLabel")}
              value={`${DEFAULT_PRICING_TABLE.exitCostMultiplier}x`}
              mono
            />
          </div>
          {preview && (
            <div className="flex flex-1 flex-col gap-0.5">
              <ReviewRow
                label={t("coverage.preview.fee")}
                value={formatBRLCents(preview.feeCents)}
                mono
              />
              <ReviewRow
                label={t("coverage.preview.activationFee")}
                value={formatBRLCents(preview.oneTimeActivationFeeCents)}
                mono
              />
            </div>
          )}
        </div>
      </section>

      {commission && (
        <div className="bg-surface-2 flex items-center justify-between px-4 py-3">
          <span className="text-muted-foreground text-base">{t("coverage.summary.guarantee")}</span>
          <span className="font-mono text-base font-semibold">
            {formatBRLCents(commission.totalCents)}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <Button variant="outline" onClick={onBack} disabled={isSubmitting || isEditing}>
          {t("nav.back")}
        </Button>
        <Button onClick={handleSubmit} disabled={isSubmitting || isEditing}>
          {isSubmitting ? t("review.submitting") : t("review.submit")}
        </Button>
      </div>
    </div>
  );
}
