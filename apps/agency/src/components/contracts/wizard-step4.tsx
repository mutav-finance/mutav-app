"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { PencilIcon } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { AgencyId } from "@convex/agencies/domain";
import { Button } from "@mutav/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@mutav/ui/toggle-group";
import { Input } from "@mutav/ui/input";
import { Label } from "@mutav/ui/label";
import { cn } from "@mutav/ui/cn";
import {
  isPropertyKind,
  parseBRLInput,
  validateWizard,
  type DraftWizardData,
} from "@/lib/contracts/wizard";
import { formatBRLCents } from "@/lib/contracts/format";
import { splitCommission } from "@/lib/pricing/commission";
import { priceContract } from "@/lib/pricing/contract";
import { RENT_COVERAGE_MONTHS, EXIT_COVERAGE_MONTHS } from "@/lib/pricing/tiers";

type Props = {
  data: DraftWizardData;
  agencyId: AgencyId;
  onChange: (patch: Partial<DraftWizardData>) => void;
  onComplete: (publicId: string) => void;
  onBack: () => void;
};

type EditingBlock = "property" | "rental" | "tenant" | null;

type MissingFields = Set<string>;

export function WizardStep4({ data, agencyId, onChange, onComplete, onBack }: Props) {
  const t = useTranslations("contractNew");
  const createContract = useMutation(api.contracts.useCases.create);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [missing, setMissing] = React.useState<MissingFields>(new Set());
  const [editingBlock, setEditingBlock] = React.useState<EditingBlock>(null);
  const [draft, setDraft] = React.useState<Partial<DraftWizardData>>({});

  const preview =
    data.rentCents > 0 && data.score !== null
      ? priceContract({
          rentCents: data.rentCents,
          condoCents: data.condoCents,
          otherFeesCents: data.otherFeesCents,
          score: data.score,
        })
      : null;
  const commission = preview ? splitCommission(preview.feeCents) : null;

  const totalRentCents = data.rentCents + data.condoCents + data.otherFeesCents;

  function startEdit(block: EditingBlock) {
    setEditingBlock(block);
    setDraft({ ...data });
  }

  function saveEdit() {
    onChange(draft);
    setEditingBlock(null);
    setDraft({});
  }

  function cancelEdit() {
    setEditingBlock(null);
    setDraft({});
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

  const m = missing;
  const isEditing = editingBlock !== null;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{t("review.heading")}</h2>

      {/* Bloco 1 — Dados do Imóvel */}
      <Block
        title={t("review.propertySection")}
        onEdit={() => startEdit("property")}
        editing={editingBlock === "property"}
        disabled={isEditing && editingBlock !== "property"}
        onSave={saveEdit}
        onCancel={cancelEdit}
      >
        {editingBlock === "property" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <EditField label={t("property.kindLabel")} className="sm:col-span-2">
              <ToggleGroup
                type="single"
                value={draft.propertyKind ?? ""}
                onValueChange={(v) => {
                  if (!isPropertyKind(v)) return;
                  setDraft((d) => ({ ...d, propertyKind: v }));
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
                value={draft.cep ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, cep: e.target.value }))}
              />
            </EditField>
            <EditField label={t("property.neighborhood")}>
              <Input
                value={draft.neighborhood ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, neighborhood: e.target.value }))}
              />
            </EditField>
            <EditField label={t("property.street")} className="sm:col-span-2">
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Input
                  value={draft.street ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, street: e.target.value }))}
                />
                <Input
                  className="w-24"
                  value={draft.addressNumber ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, addressNumber: e.target.value }))}
                  placeholder={t("property.addressNumber")}
                />
              </div>
            </EditField>
            <EditField label={t("property.city")}>
              <Input
                value={draft.city ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value }))}
              />
            </EditField>
            <EditField label={t("property.uf")}>
              <Input
                maxLength={2}
                className="uppercase"
                value={draft.uf ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, uf: e.target.value.toUpperCase() }))}
              />
            </EditField>
            <EditField label={t("property.complement")} className="sm:col-span-2">
              <Input
                value={draft.complement ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, complement: e.target.value }))}
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
              missing={m.has("propertyKind")}
            />
            <ReviewRow label={t("property.cep")} value={data.cep} mono missing={m.has("cep")} />
            <ReviewRow
              label={t("property.street")}
              value={data.street}
              missing={m.has("street")}
              className="col-span-2"
            />
            <ReviewRow
              label={t("property.addressNumber")}
              value={data.addressNumber}
              missing={m.has("addressNumber")}
            />
            <ReviewRow
              label={t("property.neighborhood")}
              value={data.neighborhood}
              missing={m.has("neighborhood")}
            />
            <ReviewRow label={t("property.city")} value={data.city} missing={m.has("city")} />
            <ReviewRow label={t("property.uf")} value={data.uf} missing={m.has("uf")} />
            {data.complement && (
              <ReviewRow
                label={t("property.complement")}
                value={data.complement}
                className="col-span-2"
              />
            )}
          </div>
        )}
      </Block>

      {/* Bloco 2 — Dados de Locação */}
      <Block
        title={t("review.rentalSection")}
        onEdit={() => startEdit("rental")}
        editing={editingBlock === "rental"}
        disabled={isEditing && editingBlock !== "rental"}
        onSave={saveEdit}
        onCancel={cancelEdit}
      >
        {editingBlock === "rental" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <EditField label={t("rent.rent")}>
              <Input
                placeholder="R$ 0,00"
                defaultValue={
                  data.rentCents ? (data.rentCents / 100).toFixed(2).replace(".", ",") : ""
                }
                onBlur={(e) =>
                  setDraft((d) => ({ ...d, rentCents: parseBRLInput(e.target.value) }))
                }
              />
            </EditField>
            <EditField label={t("rent.condo")}>
              <Input
                placeholder="R$ 0,00"
                defaultValue={
                  data.condoCents ? (data.condoCents / 100).toFixed(2).replace(".", ",") : ""
                }
                onBlur={(e) =>
                  setDraft((d) => ({ ...d, condoCents: parseBRLInput(e.target.value) }))
                }
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
                onBlur={(e) =>
                  setDraft((d) => ({ ...d, otherFeesCents: parseBRLInput(e.target.value) }))
                }
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
                missing={m.has("rentCents")}
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
      </Block>

      {/* Bloco 3 — Dados do Inquilino */}
      <Block
        title={t("review.tenantSection")}
        onEdit={() => startEdit("tenant")}
        editing={editingBlock === "tenant"}
        disabled={isEditing && editingBlock !== "tenant"}
        onSave={saveEdit}
        onCancel={cancelEdit}
      >
        {editingBlock === "tenant" ? (
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
                  value={draft.birthDate ?? ""}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setDraft((d) => ({ ...d, birthDate: e.target.value }))}
                />
              </EditField>
            )}
            <EditField label={t("tenant.email")}>
              <Input
                type="email"
                value={draft.email ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
              />
            </EditField>
            <EditField label={t("tenant.phone")}>
              <Input
                value={draft.phone ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
              />
            </EditField>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
            <ReviewRow
              label={data.entityType === "pj" ? t("tenant.companyName") : t("tenant.fullName")}
              value={data.fullName}
              missing={m.has("fullName")}
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
                missing={m.has("birthDate")}
              />
            )}
            <ReviewRow label={t("tenant.email")} value={data.email} missing={m.has("email")} />
            <ReviewRow label={t("tenant.phone")} value={data.phone} mono missing={m.has("phone")} />
            {data.score !== null && data.scoreTier !== null && (
              <ReviewRow
                label={t("review.score")}
                value={`${data.score} (${data.scoreTier})`}
                mono
              />
            )}
          </div>
        )}
      </Block>

      {/* Bloco 4 — Dados do Plano */}
      <section className="flex flex-col gap-2 rounded-lg border p-4">
        <p className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
          {t("review.planSection")}
        </p>
        <div className="flex gap-8">
          <div className="flex flex-1 flex-col gap-0.5">
            <ReviewRow
              label={t("coverage.rentMultiplierLabel")}
              value={`${RENT_COVERAGE_MONTHS}x`}
              mono
            />
            <ReviewRow
              label={t("coverage.exitCostLabel")}
              value={`${EXIT_COVERAGE_MONTHS}x`}
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

function Block({
  title,
  children,
  onEdit,
  onSave,
  onCancel,
  editing,
  disabled,
}: {
  title: string;
  children: React.ReactNode;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  editing: boolean;
  disabled: boolean;
}) {
  const t = useTranslations("contractNew");
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
            {t("review.editBlock")}
          </button>
        )}
      </div>
      {children}
      {editing && (
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            {t("review.cancelBlock")}
          </Button>
          <Button size="sm" onClick={onSave}>
            {t("review.saveBlock")}
          </Button>
        </div>
      )}
    </section>
  );
}

function ReviewRow({
  label,
  value,
  highlight,
  mono,
  missing,
  large,
  className,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  mono?: boolean;
  missing?: boolean;
  large?: boolean;
  className?: string;
}) {
  const t = useTranslations("contractNew");
  const size = large ? "text-base" : "text-sm";
  return (
    <div className={cn("flex items-baseline gap-1.5 py-0.5", className)}>
      <span className={cn("text-muted-foreground shrink-0", size)}>{label}:</span>
      {missing ? (
        <span className="text-destructive text-sm font-medium">{t("validation.required")}</span>
      ) : (
        <span className={cn(size, mono && "font-mono", highlight && "font-semibold")}>
          {value || "—"}
        </span>
      )}
    </div>
  );
}

function EditField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function LockedDisplay({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label className="text-muted-foreground">{label}</Label>
      <div className="bg-muted/50 border-input text-muted-foreground rounded-md border px-3 py-2 font-mono text-sm">
        {value}
      </div>
    </div>
  );
}
