"use client";

import {
  Drawer,
  DrawerDescription,
  DrawerHeader,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
} from "@louez/ui";

import { ProductBundleManager } from "./product-bundle-manager";

interface ProductBundleManagerDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ProductBundleManagerDrawer = ({
  open,
  onOpenChange,
}: ProductBundleManagerDrawerProps) => {
  return (
    <Drawer position="right" open={open} onOpenChange={onOpenChange}>
      <DrawerPopup variant="inset" showCloseButton>
        <DrawerHeader>
          <DrawerTitle>Zestawy produktów</DrawerTitle>
          <DrawerDescription>
            Twórz i edytuj gotowe paczki produktów do szybkiego wyboru w rezerwacjach oraz w sklepie
            klienta.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerPanel>
          <ProductBundleManager />
        </DrawerPanel>
      </DrawerPopup>
    </Drawer>
  );
};
