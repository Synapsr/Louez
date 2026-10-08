"use client";

import { useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PencilSolidIcon, SpinnerSolidIcon, TrashSolidIcon } from "@louez/ui/icons";
import { ChevronDown, Loader2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Drawer,
  DrawerDescription,
  DrawerHeader,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Switch,
  toastManager,
} from "@louez/ui";
import { cn, findMatchingVariant } from "@louez/utils";

import { VariantColorPicker } from "@/components/dashboard/variant-color-picker";
import { orpc } from "@/lib/orpc/react";
import { type ResolvedVariantPreset, resolveVariantPresets } from "@/lib/variant-presets";

interface VariantManagerValue {
  id: string;
  label: string;
  colorHex: string | null;
  position: number;
}

interface VariantManagerDefinition {
  id: string;
  key: string;
  label: string;
  kind: "size" | "color" | "custom";
  isActive: boolean;
  position: number;
  values: VariantManagerValue[];
}

interface ManagedVariant {
  key: string;
  label: string;
  kind: "size" | "color" | "custom";
  isActive: boolean;
  isCustom: boolean;
  definition?: VariantManagerDefinition;
  preset?: ResolvedVariantPreset;
  values: Array<{
    id: string | null;
    label: string;
    colorHex: string | null;
  }>;
}

const DEFAULT_NEW_COLOR = "#3B82F6";
const OPTIMISTIC_VALUE_ID_PREFIX = "optimistic:";

export const VariantManagerDrawer = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const t = useTranslations("dashboard.products.form.unitTracking");

  return (
    <Drawer position="right" open={open} onOpenChange={onOpenChange}>
      <DrawerPopup variant="inset" className="max-w-xl" showCloseButton>
        <DrawerHeader>
          <DrawerTitle>{t("managerTitle")}</DrawerTitle>
          <DrawerDescription>{t("managerDescription")}</DrawerDescription>
        </DrawerHeader>
        <DrawerPanel>
          <VariantManager />
        </DrawerPanel>
      </DrawerPopup>
    </Drawer>
  );
};

const VariantManager = () => {
  const t = useTranslations("dashboard.products.form.unitTracking");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();

  const catalogQuery = useQuery(orpc.dashboard.variants.list.queryOptions());
  const definitions: VariantManagerDefinition[] = catalogQuery.data ?? [];
  const catalogQueryKey = orpc.dashboard.variants.list.key({ type: "query" });
  const [activeOverrides, setActiveOverrides] = useState<Record<string, boolean>>({});
  const resolvedPresets = useMemo(() => resolveVariantPresets((key) => String(t.raw(key))), [t]);
  const managedVariants = useMemo<ManagedVariant[]>(() => {
    const matchedDefinitionIds = new Set<string>();
    const presetItems = resolvedPresets.map((preset) => {
      const definition = findMatchingVariant(preset.key, definitions);
      if (definition) matchedDefinitionIds.add(definition.id);

      return {
        key: preset.key,
        label: definition?.label ?? preset.label,
        kind: definition?.kind ?? preset.kind,
        isActive: activeOverrides[preset.key] ?? definition?.isActive ?? preset.defaultActive,
        isCustom: false,
        definition,
        preset,
        values:
          definition?.values.map((value) => ({
            id: value.id,
            label: value.label,
            colorHex: value.colorHex,
          })) ??
          preset.values.map((value) => ({
            id: null,
            label: value.label,
            colorHex: value.colorHex,
          })),
      } satisfies ManagedVariant;
    });
    const customItems = definitions
      .filter((definition) => !matchedDefinitionIds.has(definition.id))
      .map(
        (definition) =>
          ({
            key: definition.key,
            label: definition.label,
            kind: definition.kind,
            isActive: activeOverrides[definition.key] ?? definition.isActive,
            isCustom: true,
            definition,
            values: definition.values.map((value) => ({
              id: value.id,
              label: value.label,
              colorHex: value.colorHex,
            })),
          }) satisfies ManagedVariant,
      );

    return [...presetItems, ...customItems];
  }, [activeOverrides, definitions, resolvedPresets]);
  const activeCount = managedVariants.filter((variant) => variant.isActive).length;

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: orpc.dashboard.variants.key() });

  const ensureDefinitionMutation = useMutation(
    orpc.dashboard.variants.ensureDefinition.mutationOptions(),
  );
  const updateDefinitionMutation = useMutation(
    orpc.dashboard.variants.updateDefinition.mutationOptions(),
  );
  const setDefinitionActiveMutation = useMutation(
    orpc.dashboard.variants.setDefinitionActive.mutationOptions(),
  );
  const deleteDefinitionMutation = useMutation(
    orpc.dashboard.variants.deleteDefinition.mutationOptions(),
  );

  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [editing, setEditing] = useState<ManagedVariant | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [toDelete, setToDelete] = useState<VariantManagerDefinition | null>(null);

  const isMutating =
    ensureDefinitionMutation.isPending ||
    updateDefinitionMutation.isPending ||
    setDefinitionActiveMutation.isPending ||
    deleteDefinitionMutation.isPending;

  const ensurePreset = async (
    preset: ResolvedVariantPreset,
    isActive: boolean,
  ): Promise<VariantManagerDefinition | null> => {
    try {
      const definition = await ensureDefinitionMutation.mutateAsync({
        key: preset.key,
        label: preset.label,
        kind: preset.kind,
        isActive,
        values: preset.values.map((value) => ({
          label: value.label,
          colorHex: value.colorHex ?? undefined,
        })),
      });
      await invalidate();
      return definition;
    } catch {
      toastManager.add({ title: tCommon("error"), type: "error" });
      return null;
    }
  };

  const handleActiveChange = async (variant: ManagedVariant, isActive: boolean) => {
    const previousDefinitions = variant.definition
      ? queryClient.getQueryData<VariantManagerDefinition[]>(catalogQueryKey)
      : undefined;
    setActiveOverrides((current) => ({ ...current, [variant.key]: isActive }));

    try {
      if (!variant.definition) {
        if (variant.preset) await ensurePreset(variant.preset, isActive);
        return;
      }

      queryClient.setQueryData(catalogQueryKey, (current: VariantManagerDefinition[] | undefined) =>
        current?.map((definition) =>
          definition.id === variant.definition?.id ? { ...definition, isActive } : definition,
        ),
      );

      await setDefinitionActiveMutation.mutateAsync({
        id: variant.definition.id,
        isActive,
      });
      await invalidate();
    } catch {
      if (previousDefinitions) {
        queryClient.setQueryData(catalogQueryKey, previousDefinitions);
      } else {
        await invalidate();
      }
      toastManager.add({ title: tCommon("error"), type: "error" });
    } finally {
      setActiveOverrides((current) => {
        const next = { ...current };
        delete next[variant.key];
        return next;
      });
    }
  };

  const handleCreate = async () => {
    const label = newLabel.trim();
    if (label.length < 2) return;
    try {
      await ensureDefinitionMutation.mutateAsync({
        label,
        kind: "custom",
        isActive: true,
        values: [],
      });
      await invalidate();
      setNewLabel("");
      setNewDialogOpen(false);
    } catch {
      toastManager.add({ title: tCommon("error"), type: "error" });
    }
  };

  const handleRename = async () => {
    const label = editLabel.trim();
    if (!editing || label.length < 2) return;

    const definition =
      editing.definition ??
      (editing.preset ? await ensurePreset(editing.preset, editing.isActive) : null);
    if (!definition) return;

    try {
      await updateDefinitionMutation.mutateAsync({ id: definition.id, label });
      await invalidate();
      setEditing(null);
    } catch {
      toastManager.add({ title: tCommon("error"), type: "error" });
    }
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteDefinitionMutation.mutateAsync({ id: toDelete.id });
      await invalidate();
      setToDelete(null);
    } catch {
      toastManager.add({ title: tCommon("error"), type: "error" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {t("activeVariantsCount", {
            active: activeCount,
            total: managedVariants.length,
          })}
        </p>
        <Button type="button" size="sm" onClick={() => setNewDialogOpen(true)}>
          <Plus className="size-4" />
          {t("newVariant")}
        </Button>
      </div>

      {catalogQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        </div>
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border">
          {managedVariants.map((variant) => (
            <VariantDefinitionRow
              key={variant.key}
              variant={variant}
              disabled={isMutating}
              onActiveChange={(isActive) => handleActiveChange(variant, isActive)}
              onEnsure={() =>
                variant.preset
                  ? ensurePreset(variant.preset, variant.isActive)
                  : Promise.resolve(variant.definition ?? null)
              }
              onRename={() => {
                setEditing(variant);
                setEditLabel(variant.label);
              }}
              onDelete={() => {
                if (variant.definition) setToDelete(variant.definition);
              }}
              onInvalidate={invalidate}
            />
          ))}
        </div>
      )}

      {/* Create */}
      <Dialog open={newDialogOpen} onOpenChange={setNewDialogOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{t("newVariant")}</DialogTitle>
            <DialogDescription>{t("newVariantDescription")}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Input
              autoFocus
              placeholder={t("variantPlaceholder")}
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleCreate();
                }
              }}
            />
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setNewDialogOpen(false)}>
              {tCommon("cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => void handleCreate()}
              isPending={ensureDefinitionMutation.isPending}
              disabled={isMutating}
            >
              {tCommon("create")}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      {/* Rename */}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{t("editVariant")}</DialogTitle>
            <DialogDescription>{t("editVariantDescription")}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Input
              autoFocus
              value={editLabel}
              onChange={(event) => setEditLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleRename();
                }
              }}
            />
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              {tCommon("cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => void handleRename()}
              isPending={updateDefinitionMutation.isPending}
              disabled={isMutating}
            >
              {tCommon("save")}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      {/* Delete */}
      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open) setToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteVariantTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteVariantDescription", { name: toDelete?.label ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button type="button" variant="outline" />}>
              {tCommon("cancel")}
            </AlertDialogClose>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDelete()}
              isPending={deleteDefinitionMutation.isPending}
              disabled={isMutating}
            >
              {tCommon("delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

const VariantDefinitionRow = ({
  variant,
  disabled,
  onActiveChange,
  onEnsure,
  onRename,
  onDelete,
  onInvalidate,
}: {
  variant: ManagedVariant;
  disabled: boolean;
  onActiveChange: (isActive: boolean) => Promise<void>;
  onEnsure: () => Promise<VariantManagerDefinition | null>;
  onRename: () => Promise<void> | void;
  onDelete: () => void;
  onInvalidate: () => Promise<unknown> | void;
}) => {
  const t = useTranslations("dashboard.products.form.unitTracking");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [newValue, setNewValue] = useState("");
  const [newColor, setNewColor] = useState(DEFAULT_NEW_COLOR);
  const [editingValue, setEditingValue] = useState<{
    id: string | null;
    label: string;
    colorHex: string | null;
  } | null>(null);
  const [editValueLabel, setEditValueLabel] = useState("");
  const [editValueColor, setEditValueColor] = useState(DEFAULT_NEW_COLOR);

  const catalogQueryKey = orpc.dashboard.variants.list.key({ type: "query" });
  const createValueMutation = useMutation(
    orpc.dashboard.variants.createValue.mutationOptions({
      onMutate: async (input) => {
        const optimisticId = `${OPTIMISTIC_VALUE_ID_PREFIX}${crypto.randomUUID()}`;
        await queryClient.cancelQueries({ queryKey: catalogQueryKey });
        queryClient.setQueryData(
          catalogQueryKey,
          (current: VariantManagerDefinition[] | undefined) =>
            current?.map((definition) =>
              definition.id === input.definitionId
                ? {
                    ...definition,
                    values: [
                      ...definition.values,
                      {
                        id: optimisticId,
                        label: input.label,
                        colorHex: input.colorHex ?? null,
                        position: definition.values.length,
                      },
                    ],
                  }
                : definition,
            ),
        );
        return { optimisticId };
      },
      onError: (_error, input, context) => {
        if (context?.optimisticId) {
          queryClient.setQueryData(
            catalogQueryKey,
            (current: VariantManagerDefinition[] | undefined) =>
              current?.map((definition) =>
                definition.id === input.definitionId
                  ? {
                      ...definition,
                      values: definition.values.filter(
                        (value) => value.id !== context.optimisticId,
                      ),
                    }
                  : definition,
              ),
          );
        }
        toastManager.add({ title: tCommon("error"), type: "error" });
      },
      onSuccess: (created, input, context) => {
        queryClient.setQueryData(
          catalogQueryKey,
          (current: VariantManagerDefinition[] | undefined) =>
            current?.map((definition) => {
              if (definition.id !== input.definitionId) return definition;
              let optimisticValueReplaced = false;
              const values = definition.values.flatMap((value) => {
                if (value.id === context.optimisticId) {
                  optimisticValueReplaced = true;
                  return [created];
                }

                if (
                  value.id === created.id ||
                  value.label.toLocaleLowerCase() === created.label.toLocaleLowerCase()
                ) {
                  return [];
                }

                return [value];
              });

              return {
                ...definition,
                values: optimisticValueReplaced ? values : [...values, created],
              };
            }),
        );
      },
    }),
  );
  const updateValueMutation = useMutation(orpc.dashboard.variants.updateValue.mutationOptions());
  const deleteValueMutation = useMutation(orpc.dashboard.variants.deleteValue.mutationOptions());

  const handleAddValue = async () => {
    const label = newValue.trim();
    if (!label) return;
    const definitionId = variant.definition?.id ?? (await onEnsure())?.id;
    if (!definitionId) return;
    setNewValue("");
    createValueMutation.mutate({
      definitionId,
      label,
      colorHex: variant.kind === "color" ? newColor : undefined,
    });
  };

  const resolvePersistedValue = async (
    value: ManagedVariant["values"][number],
  ): Promise<Omit<VariantManagerValue, "position"> | null> => {
    if (value.id) {
      return {
        id: value.id,
        label: value.label,
        colorHex: value.colorHex,
      };
    }

    const definition = await onEnsure();
    return (
      definition?.values.find(
        (persistedValue) =>
          persistedValue.label.toLocaleLowerCase() === value.label.toLocaleLowerCase(),
      ) ?? null
    );
  };

  const handleStartEditValue = (value: ManagedVariant["values"][number]) => {
    setEditingValue(value);
    setEditValueLabel(value.label);
    setEditValueColor(value.colorHex ?? DEFAULT_NEW_COLOR);
  };

  const handleUpdateValue = async () => {
    const label = editValueLabel.trim();
    if (!editingValue || !label) return;

    const persistedValue = await resolvePersistedValue(editingValue);
    if (!persistedValue) return;

    try {
      await updateValueMutation.mutateAsync({
        id: persistedValue.id,
        label,
        colorHex: variant.kind === "color" ? editValueColor : undefined,
      });
      await onInvalidate();
      setEditingValue(null);
    } catch {
      toastManager.add({ title: tCommon("error"), type: "error" });
    }
  };

  const handleDeleteValue = async (value: ManagedVariant["values"][number]) => {
    const persistedValue = await resolvePersistedValue(value);
    if (!persistedValue) return;

    try {
      await deleteValueMutation.mutateAsync({ id: persistedValue.id });
      await onInvalidate();
    } catch {
      toastManager.add({ title: tCommon("error"), type: "error" });
    }
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 transition-opacity",
          !variant.isActive && "opacity-60",
        )}
      >
        <CollapsibleTrigger
          render={
            <button type="button" className="flex min-w-44 flex-1 items-center gap-2 text-left" />
          }
        >
          <ChevronDown
            className={cn(
              "text-muted-foreground size-4 shrink-0 transition-transform duration-200 ease-out",
              open && "rotate-180",
            )}
          />
          <span className="min-w-0 flex-1 truncate font-medium">{variant.label}</span>
          <Badge variant="expired" className="shrink-0">
            {t("valuesCount", { count: variant.values.length })}
          </Badge>
        </CollapsibleTrigger>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Badge variant={variant.isActive ? "success" : "expired"} className="shrink-0">
            {variant.isActive ? t("variantActive") : t("variantInactive")}
          </Badge>
          <span
            className="inline-flex"
            onPointerDownCapture={(event) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              void onActiveChange(!variant.isActive);
            }}
            onKeyDownCapture={(event) => {
              if (event.key !== " " && event.key !== "Enter") return;
              event.preventDefault();
              event.stopPropagation();
              void onActiveChange(!variant.isActive);
            }}
          >
            <Switch
              checked={variant.isActive}
              data-variant-toggle={variant.key}
              disabled={disabled}
              aria-label={t("toggleVariant", {
                name: variant.label,
                status: variant.isActive ? t("variantActive") : t("variantInactive"),
              })}
            />
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  disabled={disabled}
                  aria-label={`${tCommon("edit")} ${variant.label}`}
                />
              }
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void onRename()}>
                <Pencil className="size-4" />
                {tCommon("edit")}
              </DropdownMenuItem>
              {variant.isCustom && (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={onDelete}
                >
                  <Trash2 className="size-4" />
                  {tCommon("delete")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <CollapsibleContent>
        <div className="space-y-3 px-4 pt-1 pb-4">
          {variant.values.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {variant.values.map((value) => {
                const valueId = value.id;
                const isOptimistic = valueId?.startsWith(OPTIMISTIC_VALUE_ID_PREFIX) ?? false;
                return (
                  <Badge
                    key={valueId ?? `${variant.key}-${value.label}`}
                    variant="expired"
                    className="gap-1 pr-1"
                  >
                    {value.colorHex && (
                      <span
                        className="h-2 w-2 rounded-full ring-1 ring-black/15 ring-inset"
                        style={{ backgroundColor: value.colorHex }}
                      />
                    )}
                    {value.label}
                    {isOptimistic ? (
                      <SpinnerSolidIcon className="size-3 animate-spin" />
                    ) : (
                      <>
                        <button
                          type="button"
                          className="rounded-sm p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
                          onClick={() => void handleStartEditValue(value)}
                          disabled={disabled || updateValueMutation.isPending}
                          aria-label={`${tCommon("edit")} ${value.label}`}
                        >
                          <PencilSolidIcon className="size-3" />
                        </button>
                        <button
                          type="button"
                          className="rounded-sm p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
                          onClick={() => void handleDeleteValue(value)}
                          disabled={disabled || deleteValueMutation.isPending}
                          aria-label={`${tCommon("delete")} ${value.label}`}
                        >
                          <TrashSolidIcon className="size-3" />
                        </button>
                      </>
                    )}
                  </Badge>
                );
              })}
            </div>
          )}
          <div className="flex items-center gap-1.5">
            {variant.kind === "color" && (
              <VariantColorPicker value={newColor} onChange={setNewColor} disabled={disabled} />
            )}
            <Input
              value={newValue}
              onChange={(event) => setNewValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleAddValue();
                }
              }}
              placeholder={t("addValuePlaceholder")}
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleAddValue()}
              disabled={disabled || !newValue.trim()}
            >
              <Plus data-slot="icon" />
            </Button>
          </div>
        </div>
      </CollapsibleContent>
      <Dialog
        open={editingValue !== null}
        onOpenChange={(dialogOpen) => {
          if (!dialogOpen) setEditingValue(null);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{t("editValue")}</DialogTitle>
            <DialogDescription>{t("editValueDescription")}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex items-center gap-2">
              {variant.kind === "color" && (
                <VariantColorPicker
                  value={editValueColor}
                  onChange={setEditValueColor}
                  disabled={updateValueMutation.isPending}
                  className="h-10 w-11"
                />
              )}
              <Input
                autoFocus
                value={editValueLabel}
                onChange={(event) => setEditValueLabel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleUpdateValue();
                  }
                }}
              />
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditingValue(null)}>
              {tCommon("cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => void handleUpdateValue()}
              isPending={updateValueMutation.isPending}
              disabled={!editValueLabel.trim()}
            >
              {tCommon("save")}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </Collapsible>
  );
};
