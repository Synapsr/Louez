export const pickActiveVariantAttributes = (
  axes: readonly { key: string }[],
  attributes: Readonly<Record<string, string>>,
): Record<string, string> =>
  Object.fromEntries(
    axes.flatMap((axis) => {
      const value = attributes[axis.key];
      return value ? [[axis.key, value] as const] : [];
    }),
  );
