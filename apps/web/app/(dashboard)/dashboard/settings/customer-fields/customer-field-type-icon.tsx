import {
  AtSign,
  Calendar,
  Hash,
  Link2,
  ListChecks,
  type LucideIcon,
  Phone,
  Text,
  ToggleLeft,
  Type,
} from "lucide-react";

import type { CustomerFieldType } from "@louez/types";

export const CUSTOMER_FIELD_TYPE_ICONS: Record<CustomerFieldType, LucideIcon> = {
  text: Type,
  textarea: Text,
  number: Hash,
  date: Calendar,
  select: ListChecks,
  checkbox: ToggleLeft,
  phone: Phone,
  email: AtSign,
  url: Link2,
};
