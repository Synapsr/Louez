"use client";

import { Package, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, Card, DisabledControlsProvider, Input } from "@louez/ui";

import { CustomerFieldLockedCell } from "./customer-field-locked-cell";
import { CustomerFieldSection } from "./customer-field-section";
import { CustomerFieldsAddSectionButton } from "./customer-fields-add-section-button";
import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { listScopeSections } from "./util.customer-fields-builder";

/**
 * "Par article loué": what is recorded for each rented unit, on the
 * reservation. Drawn as one sample unit, the way the team fills it in:
 * the product, "Pour qui ?" (built in), then the sections.
 */
export const CustomerFieldsItemArea = () => {
  const t = useTranslations("dashboard.settings.customerFields");
  const tDetails = useTranslations("dashboard.reservationDetails.itemDetails");
  const { fields, localSections, readOnly, openPicker } = useCustomerFieldsBuilder();
  const sections = listScopeSections(fields, "item", localSections);
  const savedCount = sections.filter((section) => section.localKey === null).length;

  return (
    <section aria-labelledby="customer-fields-item-area" className="flex flex-col gap-3 pt-4">
      <div className="ps-1">
        <h3 id="customer-fields-item-area" className="text-base font-semibold leading-snug">
          {t("builder.item.title")}
        </h3>
        <p className="text-muted-foreground text-sm">{t("builder.item.description")}</p>
      </div>

      <Card className="gap-3 p-3 sm:p-4">
        <div className="flex items-center gap-3 ps-1">
          <span
            aria-hidden
            className="bg-muted text-muted-foreground flex h-9 w-12 shrink-0 items-center justify-center rounded-lg"
          >
            <Package className="size-4" />
          </span>
          <p className="min-w-0 text-sm font-medium">{t("preview.client.sampleProduct")}</p>
        </div>

        <DisabledControlsProvider disabled>
          {/* Indented like the rows (past the drag handle's room), so the labels line up. */}
          <div inert className="py-1 ps-8 pe-2">
            <CustomerFieldLockedCell
              label={tDetails("participantName")}
              note={t("builder.item.participantLocked")}
            >
              <Input placeholder={tDetails("participantNamePlaceholder")} className="bg-muted/60" />
            </CustomerFieldLockedCell>
          </div>
        </DisabledControlsProvider>

        {sections.map((section, index) => (
          <CustomerFieldSection
            key={section.localKey ?? section.name}
            scope="item"
            section={section}
            variant="plain"
            canMoveUp={section.localKey === null && index > 0}
            canMoveDown={section.localKey === null && index < savedCount - 1}
          />
        ))}

        {sections.length === 0 && (
          <div className="flex flex-col items-start gap-2 ps-8">
            <p className="text-muted-foreground text-sm">{t("builder.item.empty")}</p>
            {!readOnly && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openPicker({ scope: "item", section: null })}
              >
                <Plus />
                {t("field.add")}
              </Button>
            )}
          </div>
        )}

        {!readOnly && sections.length > 0 && <CustomerFieldsAddSectionButton scope="item" />}
      </Card>
    </section>
  );
};
