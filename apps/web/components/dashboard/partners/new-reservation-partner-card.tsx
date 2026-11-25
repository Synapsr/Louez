"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@louez/ui";

import { partnersQueries } from "@/lib/queries/partners.queries";

const NO_PARTNER = "none";

interface NewReservationPartnerCardProps {
  partnerId: string | null;
  onChange: (partnerId: string | null) => void;
}

/**
 * A reservation made by hand for a customer a partner sent (by phone, at the
 * counter): credited to that partner once created. Not shown for a store
 * without active partners.
 */
export const NewReservationPartnerCard = ({
  partnerId,
  onChange,
}: NewReservationPartnerCardProps) => {
  const t = useTranslations("dashboard.partners.newReservation");
  const { data } = useQuery(partnersQueries.list());
  const options = (data?.partners ?? []).filter((partner) => !partner.archived);
  if (options.length === 0) return null;

  const items = {
    [NO_PARTNER]: t("none"),
    ...Object.fromEntries(options.map((partner) => [partner.id, partner.name])),
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Select
          items={items}
          value={partnerId ?? NO_PARTNER}
          onValueChange={(value) => onChange(!value || value === NO_PARTNER ? null : value)}
        >
          <SelectTrigger className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_PARTNER}>{t("none")}</SelectItem>
            {options.map((partner) => (
              <SelectItem key={partner.id} value={partner.id}>
                {partner.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
};
