"use client";

import { CustomerFieldSection } from "./customer-field-section";
import { CustomerFieldsAddSectionButton } from "./customer-fields-add-section-button";
import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { CustomerFieldsEmptyInvite } from "./customer-fields-empty-invite";
import { CustomerFieldsItemArea } from "./customer-fields-item-area";
import { CustomerFieldsLockedCard } from "./customer-fields-locked-card";
import { CustomerProfileFieldsCard } from "./customer-profile-fields-card";
import { listScopeSections } from "./util.customer-fields-builder";

/**
 * The customer form as the team fills it in, top to bottom: the contact
 * block Louez always has, the profile fields it ships with, the store's own
 * sections, then what is recorded per rented unit. Hidden fields stay in
 * their place, greyed.
 */
export const CustomerFieldsTeamCanvas = () => {
  const { fields, localSections, readOnly } = useCustomerFieldsBuilder();
  const sections = listScopeSections(fields, "customer", localSections);
  const savedCount = sections.filter((section) => section.localKey === null).length;
  // Hidden fields count: they are on the canvas, waiting to be shown again.
  const hasOwnFields = fields.length > 0 || localSections.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <CustomerFieldsLockedCard />
      <CustomerProfileFieldsCard />

      {hasOwnFields ? (
        <>
          {sections.map((section, index) => (
            <CustomerFieldSection
              key={section.localKey ?? section.name}
              scope="customer"
              section={section}
              variant="card"
              canMoveUp={section.localKey === null && index > 0}
              canMoveDown={section.localKey === null && index < savedCount - 1}
            />
          ))}
          {!readOnly && <CustomerFieldsAddSectionButton scope="customer" />}
          <CustomerFieldsItemArea />
        </>
      ) : (
        <CustomerFieldsEmptyInvite />
      )}
    </div>
  );
};
