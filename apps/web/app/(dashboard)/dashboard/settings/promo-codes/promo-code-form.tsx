"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PercentageIcon, PricingIcon } from "@louez/ui/icons";
import { Shuffle } from "lucide-react";
import { nanoid } from "nanoid";
import {
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  Label,
  Switch,
  toastManager,
} from "@louez/ui";

import { FormRadioCardGroup } from "@/components/form/form-radio-card-group";
import { ReservationDatePickerControl } from "@/components/form/form-reservation-date-picker";

import { createPromoCode, updatePromoCode } from "./actions";

interface PromoCode {
  id: string;
  code: string;
  description: string | null;
  type: "percentage" | "fixed";
  value: string;
  minimumAmount: string | null;
  maxUsageCount: number | null;
  currentUsageCount: number;
  startsAt: Date | null;
  expiresAt: Date | null;
  isActive: boolean;
}

interface PromoCodeFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingCode: PromoCode | null;
  currency: string;
  readOnly?: boolean;
}

function generateCode(): string {
  return nanoid(8)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "X");
}

export function PromoCodeFormDialog({
  open,
  onOpenChange,
  editingCode,
  currency,
  readOnly = false,
}: PromoCodeFormDialogProps) {
  const router = useRouter();
  const t = useTranslations("dashboard.settings.promoCodes");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Form state
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<"percentage" | "fixed">("percentage");
  const [value, setValue] = useState("");
  const [minimumAmount, setMinimumAmount] = useState("");
  const [maxUsageCount, setMaxUsageCount] = useState("");
  const [startsAt, setStartsAt] = useState<Date | undefined>();
  const [expiresAt, setExpiresAt] = useState<Date | undefined>();
  const [isActive, setIsActive] = useState(true);

  // Reset form when dialog opens/closes or editingCode changes
  useEffect(() => {
    if (open) {
      if (editingCode) {
        setCode(editingCode.code);
        setDescription(editingCode.description ?? "");
        setType(editingCode.type);
        setValue(String(parseFloat(editingCode.value)));
        setMinimumAmount(
          editingCode.minimumAmount ? String(parseFloat(editingCode.minimumAmount)) : "",
        );
        setMaxUsageCount(
          editingCode.maxUsageCount !== null ? String(editingCode.maxUsageCount) : "",
        );
        setStartsAt(editingCode.startsAt ?? undefined);
        setExpiresAt(editingCode.expiresAt ?? undefined);
        setIsActive(editingCode.isActive);
      } else {
        setCode("");
        setDescription("");
        setType("percentage");
        setValue("");
        setMinimumAmount("");
        setMaxUsageCount("");
        setStartsAt(undefined);
        setExpiresAt(undefined);
        setIsActive(true);
      }
      setErrors({});
    }
  }, [open, editingCode]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (code.trim().length < 2) {
      newErrors.code = t("validation.codeRequired");
    } else if (!/^[A-Z0-9_-]+$/i.test(code.trim())) {
      newErrors.code = t("validation.codeFormat");
    }

    const numValue = parseFloat(value);
    if (!value || isNaN(numValue) || numValue <= 0) {
      newErrors.value = t("validation.valueRequired");
    } else if (type === "percentage" && numValue > 100) {
      newErrors.value = t("validation.maxPercentage");
    }

    if (startsAt && expiresAt) {
      if (expiresAt <= startsAt) {
        newErrors.expiresAt = t("validation.expiresAfterStarts");
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (readOnly) return;
    if (!validate()) return;

    setIsLoading(true);
    try {
      const data = {
        code: code.trim().toUpperCase(),
        description: description.trim() || undefined,
        type,
        value: parseFloat(value),
        minimumAmount: minimumAmount ? parseFloat(minimumAmount) : null,
        maxUsageCount: maxUsageCount ? parseInt(maxUsageCount) : null,
        startsAt: startsAt ?? null,
        expiresAt: expiresAt ?? null,
        isActive,
      };

      const result = editingCode
        ? await updatePromoCode(editingCode.id, data)
        : await createPromoCode(data);

      if (result.error) {
        const errorKey = result.error.replace("errors.", "");
        toastManager.add({ title: tErrors(errorKey), type: "error" });
      } else {
        toastManager.add({ title: t("saved"), type: "success" });
        onOpenChange(false);
        router.refresh();
      }
    } catch {
      toastManager.add({ title: tErrors("generic"), type: "error" });
    } finally {
      setIsLoading(false);
    }
  };

  const isEditing = !!editingCode;
  const currencySymbol = currency === "EUR" ? "\u20ac" : currency;
  const typeOptions = [
    {
      value: "percentage",
      label: t("percentage"),
      description: t("percentageDescription"),
      icon: PercentageIcon,
    },
    {
      value: "fixed",
      label: t("fixedAmount"),
      description: t("fixedAmountDescription", { currency: currencySymbol }),
      icon: PricingIcon,
    },
  ] as const;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={!readOnly}>
      <DialogPopup
        className="sm:max-w-lg"
        initialFocus={readOnly ? false : undefined}
        finalFocus={readOnly ? false : undefined}
      >
        <DialogHeader>
          <DialogTitle>{isEditing ? t("editCode") : t("createCode")}</DialogTitle>
          <DialogDescription>
            {isEditing ? t("editDescription") : t("createDescription")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-5">
          {/* Code */}
          <div className="space-y-2">
            <Label htmlFor="promo-code">{t("code")}</Label>
            <InputGroup>
              <InputGroupInput
                id="promo-code"
                data-demo-target="promo-code-input"
                placeholder={t("codePlaceholder")}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="font-mono uppercase"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-sm"
                  onClick={() => setCode(generateCode())}
                  title={t("generateRandom")}
                  aria-label={t("generateRandom")}
                >
                  <Shuffle className="h-4 w-4" />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            {errors.code && <p className="text-sm text-destructive">{errors.code}</p>}
          </div>

          {/* Type selector */}
          <FormRadioCardGroup
            value={type}
            onChange={setType}
            options={typeOptions}
            label={t("type")}
            columns={2}
          />

          {/* Value */}
          <div className="space-y-2">
            <Label htmlFor="promo-value">{t("value")}</Label>
            <InputGroup>
              <InputGroupInput
                id="promo-value"
                type="number"
                step={type === "percentage" ? "1" : "0.01"}
                min="0.01"
                max={type === "percentage" ? "100" : undefined}
                placeholder={type === "percentage" ? "20" : "10.00"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>{type === "percentage" ? "%" : currencySymbol}</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            {errors.value && <p className="text-sm text-destructive">{errors.value}</p>}
          </div>

          {/* Minimum amount */}
          <div className="space-y-2">
            <Label htmlFor="promo-min-amount">{t("minimumAmount")}</Label>
            <InputGroup>
              <InputGroupInput
                id="promo-min-amount"
                type="number"
                step="0.01"
                min="0"
                placeholder={t("minimumAmountPlaceholder")}
                value={minimumAmount}
                onChange={(e) => setMinimumAmount(e.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>{currencySymbol}</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            <p className="text-xs text-muted-foreground">{t("minimumAmountDescription")}</p>
          </div>

          {/* Max usage count */}
          <div className="space-y-2">
            <Label htmlFor="promo-max-usage">{t("maxUsage")}</Label>
            <Input
              id="promo-max-usage"
              type="number"
              step="1"
              min="1"
              placeholder={t("unlimited")}
              value={maxUsageCount}
              onChange={(e) => setMaxUsageCount(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("maxUsageDescription")}</p>
          </div>

          {/* Date range */}
          <div className="grid gap-4 sm:grid-cols-2">
            <ReservationDatePickerControl
              id="promo-starts-at"
              disabled={readOnly}
              label={t("startsAt")}
              value={startsAt}
              onChange={setStartsAt}
              showTime={false}
            />
            <ReservationDatePickerControl
              id="promo-expires-at"
              disabled={readOnly}
              label={t("expiresAt")}
              value={expiresAt}
              onChange={setExpiresAt}
              showTime={false}
              referenceDate={startsAt}
              error={errors.expiresAt}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="promo-description">{t("descriptionLabel")}</Label>
            <Input
              id="promo-description"
              placeholder={t("descriptionPlaceholder")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Active toggle */}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">{t("activeToggle")}</p>
              <p className="text-xs text-muted-foreground">{t("activeToggleDescription")}</p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button onClick={handleSubmit} isPending={isLoading} disabled={readOnly}>
            {isEditing ? tCommon("save") : tCommon("create")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
