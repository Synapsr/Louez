"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";

import { Check, Loader2, Minus, Package, Pencil, Plus, Search, Trash2, X } from "lucide-react";

import { Badge, Button, Input, Label, Switch, Textarea, toastManager } from "@louez/ui";
import { cn } from "@louez/utils";

import {
  createProductBundleAction,
  type DashboardBundleProductOption,
  type DashboardProductBundle,
  deleteProductBundleAction,
  listProductBundlesData,
  updateProductBundleAction,
} from "@/app/(dashboard)/dashboard/products/bundle-actions";

interface DraftBundleItem {
  productId: string;
  quantity: number;
}

export const ProductBundleManager = () => {
  const [bundles, setBundles] = useState<DashboardProductBundle[]>([]);
  const [availableProducts, setAvailableProducts] = useState<DashboardBundleProductOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  const [editingBundleId, setEditingBundleId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [draftItems, setDraftItems] = useState<DraftBundleItem[]>([]);
  const [productSearch, setProductSearch] = useState("");

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await listProductBundlesData();
      setBundles(result.bundles);
      setAvailableProducts(result.availableProducts);
    } catch (error) {
      toastManager.add({
        title: error instanceof Error ? error.message : "Nie udało się pobrać zestawów produktów",
        type: "error",
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const productsById = useMemo(
    () => new Map(availableProducts.map((product) => [product.id, product])),
    [availableProducts],
  );

  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    if (!query) return availableProducts;
    return availableProducts.filter((product) => product.name.toLowerCase().includes(query));
  }, [availableProducts, productSearch]);

  const resetForm = () => {
    setEditingBundleId(null);
    setIsFormOpen(false);
    setName("");
    setDescription("");
    setIsActive(true);
    setDraftItems([]);
    setProductSearch("");
  };

  const openCreateForm = () => {
    setEditingBundleId(null);
    setName("");
    setDescription("");
    setIsActive(true);
    setDraftItems([]);
    setProductSearch("");
    setIsFormOpen(true);
  };

  const openEditForm = (bundle: DashboardProductBundle) => {
    setEditingBundleId(bundle.id);
    setName(bundle.name);
    setDescription(bundle.description ?? "");
    setIsActive(bundle.isActive);
    setDraftItems(
      bundle.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      })),
    );
    setProductSearch("");
    setIsFormOpen(true);
  };

  const toggleProductInDraft = (productId: string) => {
    setDraftItems((current) => {
      const exists = current.some((item) => item.productId === productId);
      if (exists) {
        return current.filter((item) => item.productId !== productId);
      }
      return [...current, { productId, quantity: 1 }];
    });
  };

  const updateDraftItemQuantity = (productId: string, nextQuantity: number) => {
    const clamped = Math.max(1, Math.min(999, nextQuantity));
    setDraftItems((current) =>
      current.map((item) =>
        item.productId === productId ? { ...item, quantity: clamped } : item,
      ),
    );
  };

  const handleSave = () => {
    if (!name.trim()) {
      toastManager.add({ title: "Podaj nazwę zestawu", type: "error" });
      return;
    }
    if (draftItems.length === 0) {
      toastManager.add({ title: "Dodaj co najmniej jeden produkt do zestawu", type: "error" });
      return;
    }

    startTransition(async () => {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        isActive,
        items: draftItems,
      };
      const result = editingBundleId
        ? await updateProductBundleAction({ ...payload, id: editingBundleId })
        : await createProductBundleAction(payload);

      if (!result.success) {
        toastManager.add({
          title: result.error ?? "Nie udało się zapisać zestawu",
          type: "error",
        });
        return;
      }

      toastManager.add({
        title: editingBundleId ? "Zaktualizowano zestaw produktów" : "Utworzono nowy zestaw produktów",
        type: "success",
      });
      resetForm();
      await loadData();
    });
  };

  const handleDelete = (bundle: DashboardProductBundle) => {
    startTransition(async () => {
      const result = await deleteProductBundleAction(bundle.id);
      if (!result.success) {
        toastManager.add({
          title: result.error ?? "Nie udało się usunąć zestawu",
          type: "error",
        });
        return;
      }
      toastManager.add({
        title: `Usunięto zestaw „${bundle.name}”`,
        type: "success",
      });
      if (editingBundleId === bundle.id) {
        resetForm();
      }
      await loadData();
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" />
        Ładowanie zestawów produktów…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {!isFormOpen ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs leading-relaxed">
            Twórz gotowe paczki sprzętu, które można jednym kliknięciem dodać podczas tworzenia
            rezerwacji w Dashboardzie oraz na stronie klienta.
          </p>
          <Button size="sm" onClick={openCreateForm} className="shrink-0">
            <Plus className="mr-1.5 size-4" />
            Nowy zestaw
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4 rounded-xl border bg-muted/20 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">
              {editingBundleId ? "Edytuj zestaw produktów" : "Nowy zestaw produktów"}
            </h3>
            <Button variant="ghost" size="icon-xs" onClick={resetForm}>
              <X className="size-4" />
            </Button>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bundle-name">Nazwa zestawu *</Label>
            <Input
              id="bundle-name"
              placeholder="np. Zestaw nagraniowy Podcast PRO"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bundle-description">Opis zestawu (opcjonalnie)</Label>
            <Textarea
              id="bundle-description"
              placeholder="Krótki opis dla klienta i zespołu, co zawiera paczka…"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2">
            <div className="flex flex-col">
              <span className="text-xs font-medium">Zestaw aktywny</span>
              <span className="text-muted-foreground text-[11px]">
                Widoczny w formularzu rezerwacji oraz w katalogu klienta
              </span>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Produkty wchodzące w skład zestawu ({draftItems.length}) *</Label>
            {draftItems.length > 0 ? (
              <div className="flex flex-col gap-2 rounded-lg border bg-background p-2.5">
                {draftItems.map((item) => {
                  const product = productsById.get(item.productId);
                  return (
                    <div
                      key={item.productId}
                      className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5 text-xs"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {product?.name ?? item.productId}
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-xs"
                          onClick={() => updateDraftItemQuantity(item.productId, item.quantity - 1)}
                        >
                          <Minus className="size-3" />
                        </Button>
                        <span className="w-7 text-center font-semibold">{item.quantity}×</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-xs"
                          onClick={() => updateDraftItemQuantity(item.productId, item.quantity + 1)}
                        >
                          <Plus className="size-3" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="text-destructive"
                          onClick={() => toggleProductInDraft(item.productId)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-center text-xs">
                Wybierz z poniższej listy produkty, które mają znaleźć się w tej paczce.
              </p>
            )}

            <div className="relative mt-1">
              <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-2.5 size-3.5" />
              <Input
                placeholder="Szukaj produktu do dodania…"
                value={productSearch}
                onChange={(event) => setProductSearch(event.target.value)}
                className="pl-8 text-xs"
              />
            </div>

            <div className="max-h-52 overflow-y-auto rounded-lg border bg-background p-1.5">
              {filteredProducts.length === 0 ? (
                <p className="text-muted-foreground py-4 text-center text-xs">
                  Brak produktów pasujących do wyszukiwania
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {filteredProducts.map((product) => {
                    const isSelected = draftItems.some((item) => item.productId === product.id);
                    return (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => toggleProductInDraft(product.id)}
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors",
                          isSelected
                            ? "bg-primary/10 font-medium text-primary"
                            : "hover:bg-muted/60",
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{product.name}</span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <span className="text-muted-foreground text-[11px]">
                            stan: {product.quantity}
                          </span>
                          {isSelected ? (
                            <Check className="size-3.5 text-primary" />
                          ) : (
                            <Plus className="text-muted-foreground size-3.5" />
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={resetForm}>
              Anuluj
            </Button>
            <Button type="button" size="sm" disabled={isPending} onClick={handleSave}>
              {isPending ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
              {editingBundleId ? "Zapisz zmiany" : "Utwórz zestaw"}
            </Button>
          </div>
        </div>
      )}

      {bundles.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-10 text-center">
          <Package className="text-muted-foreground size-8" />
          <p className="text-sm font-medium">Brak utworzonych zestawów produktów</p>
          <p className="text-muted-foreground max-w-xs text-xs">
            Utwórz pierwszy zestaw, aby szybko dodawać grupy powiązanych produktów do rezerwacji.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {bundles.map((bundle) => (
            <div
              key={bundle.id}
              className="flex flex-col gap-2.5 rounded-xl border bg-card p-3.5 shadow-2xs"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="truncate text-sm font-semibold">{bundle.name}</h4>
                    <Badge variant={bundle.isActive ? "progress" : "tertiary"}>
                      {bundle.isActive ? "Aktywny" : "Ukryty"}
                    </Badge>
                  </div>
                  {bundle.description ? (
                    <p className="text-muted-foreground mt-0.5 text-xs">{bundle.description}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    title="Edytuj zestaw"
                    onClick={() => openEditForm(bundle)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="text-destructive"
                    title="Usuń zestaw"
                    disabled={isPending}
                    onClick={() => handleDelete(bundle)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {bundle.items.map((item) => (
                  <Badge key={item.id} variant="tertiary" className="text-xs font-normal">
                    <span className="font-semibold">{item.quantity}×</span>&nbsp;{item.productName}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
