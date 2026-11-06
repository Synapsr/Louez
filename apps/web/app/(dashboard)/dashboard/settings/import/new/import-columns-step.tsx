"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Circle } from "lucide-react";
import { useTranslations } from "next-intl";

import type { ImportColumnMapping, ImportEntityType } from "@louez/types";
import { toastManager } from "@louez/ui";
import {
  CUSTOMER_IMPORT_FIELDS,
  PRODUCT_IMPORT_FIELDS,
  toCustomImportTarget,
  toImportTarget,
} from "@louez/validations";

import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { getImportRequirements } from "@/lib/import/util.import-mapping";
import { orpc } from "@/lib/orpc/react";
import { getErrorMessageKey } from "@/lib/utils/util.error-message";

import { ImportColumnRow } from "./import-column-row";
import type { ImportSourceData } from "./import-wizard.types";

interface ImportColumnsStepProps {
  entity: ImportEntityType;
  data: ImportSourceData;
  mapping: ImportColumnMapping;
  suggested: ImportColumnMapping;
  onMappingChange: (mapping: ImportColumnMapping) => void;
}

const SAMPLE_COUNT = 3;

export const ImportColumnsStep = ({
  entity,
  data,
  mapping,
  suggested,
  onMappingChange,
}: ImportColumnsStepProps) => {
  const t = useTranslations("dashboard.settings.import.columns");
  const tFields = useTranslations("dashboard.settings.customerFields");
  const tProducts = useTranslations("dashboard.settings.import.products");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();

  const fieldsOptions = orpc.dashboard.customerFields.list.queryOptions();
  const { data: definitions = [] } = useQuery(fieldsOptions);

  const createField = useMutation(
    orpc.dashboard.customerFields.create.mutationOptions({
      onError: (error) => {
        const key = getErrorMessageKey(error);
        toastManager.add({
          title: tErrors.has(key) ? tErrors(key) : tErrors("generic"),
          type: "error",
        });
      },
    }),
  );

  const isProducts = entity === "products";
  const nativeOptions = isProducts
    ? PRODUCT_IMPORT_FIELDS.map((field) => ({
        value: `field:${field}`,
        label: tProducts(`fields.${field}`),
      }))
    : CUSTOMER_IMPORT_FIELDS.map((field) => ({
        value: toImportTarget(field),
        label: t(`fields.${field}`),
      }));
  // Custom fields belong to customer records: a catalogue has none to map to.
  const customOptions = isProducts
    ? []
    : definitions
        .filter((definition) => definition.isActive)
        .map((definition) => ({
          value: toCustomImportTarget(definition.id),
          label: definition.label,
        }));

  const taken = new Set(
    Object.values(mapping).filter((target): target is string => Boolean(target)),
  );
  const mappedCount = taken.size;
  const requirementLabels = {
    contact: { label: t("contactLabel"), hint: t("missingContact") },
    name: { label: t("fields.lastName"), hint: t("missingName") },
    productName: { label: tProducts("fields.name"), hint: tProducts("missingName") },
    price: { label: tProducts("fields.price"), hint: tProducts("missingPrice") },
  };
  const requirements = getImportRequirements(entity, mapping).map((requirement) => ({
    done: requirement.isMet,
    ...requirementLabels[requirement.id],
  }));

  // A column the file calls "CPF" becomes a text field of that name, then its own target.
  const handleCreateField = (column: string) =>
    createField.mutate(
      {
        label: column.slice(0, 100),
        type: "text",
        section: tFields("sections.defaultName"),
        appliesTo: "all",
        isRequired: false,
        isSensitive: false,
        showOnContract: false,
        isSearchable: false,
        showInList: false,
      },
      {
        onSuccess: (next) => {
          queryClient.setQueryData(fieldsOptions.queryKey, next);
          const known = new Set(definitions.map((definition) => definition.id));
          const created = next.find((definition) => !known.has(definition.id));
          if (!created) return;
          onMappingChange({ ...mapping, [column]: toCustomImportTarget(created.id) });
          toastManager.add({ title: t("fieldCreated", { name: created.label }), type: "success" });
        },
      },
    );

  return (
    <div className="grid gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <DashboardSectionCard title={t("title")} description={t("description")}>
        <ul className="divide-y">
          {data.table.headers.map((column) => (
            <ImportColumnRow
              key={column}
              column={column}
              samples={data.table.rows
                .map((row) => row[column])
                .filter((value): value is string => Boolean(value))
                .slice(0, SAMPLE_COUNT)}
              target={mapping[column] ?? null}
              isSuggested={Boolean(mapping[column]) && mapping[column] === suggested[column]}
              nativeOptions={nativeOptions}
              customOptions={customOptions}
              takenTargets={taken}
              canCreateField={!isProducts && !createField.isPending}
              onChange={(target) => onMappingChange({ ...mapping, [column]: target })}
              onCreateField={() => handleCreateField(column)}
            />
          ))}
        </ul>
      </DashboardSectionCard>

      <aside className="lg:sticky lg:top-16 lg:self-start">
        <DashboardSectionCard title={t("summary")}>
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-muted-foreground mb-2 text-xs font-medium uppercase">
                {t("requiredTitle")}
              </p>
              <ul className="space-y-1.5">
                {requirements.map((item) => (
                  <li key={item.label} className="flex items-start gap-2">
                    {item.done ? (
                      <Check className="text-success mt-0.5 size-4 shrink-0" />
                    ) : (
                      <Circle className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                    )}
                    <span>
                      {item.label}
                      {!item.done && (
                        <span className="text-muted-foreground block text-xs">{item.hint}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-muted-foreground">
              {t("mapped", { count: mappedCount })} ·{" "}
              {t("ignoredCount", { count: data.table.headers.length - mappedCount })}
            </p>
          </div>
        </DashboardSectionCard>
      </aside>
    </div>
  );
};
