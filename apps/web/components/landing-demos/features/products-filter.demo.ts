import type { FeatureDemoConfig } from "@/components/landing-demos/feature-demo.types";

export const demo: FeatureDemoConfig = {
  actor: "owner",
  duration: 11000,
  cues: [
    { at: 400, selector: '[data-demo-target="products-category-filter"]' },
    { at: 1200, selector: '[data-demo-target="products-category-filter"]', press: true },
    { at: 2000, selector: '[data-product-category="electric"]' },
    { at: 2800, selector: '[data-product-category="electric"]', click: true },
    { at: 3900, selector: '[data-demo-target="products-category-filter"]' },
    { at: 4700, selector: '[data-demo-target="products-category-filter"]', press: true },
    { at: 6200, selector: '[data-demo-target="products-category-filter"]' },
    { at: 7000, selector: '[data-demo-target="products-category-filter"]', press: true },
    { at: 7800, selector: '[data-demo-target="products-clear-categories"]' },
    { at: 8600, selector: '[data-demo-target="products-clear-categories"]', click: true },
    { at: 9200, selector: '[data-demo-target="products-category-filter"]' },
    { at: 10000, selector: '[data-demo-target="products-category-filter"]', press: true },
  ],
};
