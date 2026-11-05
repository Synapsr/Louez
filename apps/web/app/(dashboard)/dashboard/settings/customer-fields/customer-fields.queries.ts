import type { QueryClient } from "@tanstack/react-query";

import type { CustomerFieldScope, ResolvedCustomerProfileSettings } from "@louez/types";

import { orpc } from "@/lib/orpc/react";

import {
  type CustomerFieldWithUsage,
  patchDefinition,
  revertPatch,
} from "./util.customer-fields-builder";
import {
  applyProfileFieldPatch,
  revertProfileFieldPatch,
} from "./util.customer-profile-field-settings";

/**
 * Every write of the fields answers with the whole list. They run one after
 * the other (a mutation scope), so answers arrive in order; while several are
 * queued, only the last one's answer replaces the list, and the earlier
 * optimistic changes are not flashed away in between.
 */
const WRITE_SCOPE = { id: "settings-customer-fields" };

/** The same, for the Louez profile fields: each write answers with their three settings. */
const PROFILE_WRITE_SCOPE = { id: "settings-customer-profile-fields" };

/** The same, for the order and widths: each write answers with the tab's whole layout. */
const LAYOUT_WRITE_SCOPE = { id: "settings-customer-form-layout" };

export const customerFieldsListOptions = () => orpc.dashboard.customerFields.list.queryOptions();

export const customerProfileSettingsOptions = () =>
  orpc.dashboard.customerFields.profileSettings.queryOptions();

export const customerFormLayoutOptions = (scope: CustomerFieldScope) =>
  orpc.dashboard.customerFields.layout.queryOptions({ input: { scope } });

export const customerFieldTargetOptions = () =>
  orpc.dashboard.customerFields.targetOptions.queryOptions();

const listKey = () => customerFieldsListOptions().queryKey;

const profileKey = () => customerProfileSettingsOptions().queryKey;

export const layoutKey = (scope: CustomerFieldScope) => customerFormLayoutOptions(scope).queryKey;

const isLastQueuedWrite = (queryClient: QueryClient, scope: { id: string }) =>
  queryClient.isMutating({
    predicate: (mutation) => mutation.options.scope?.id === scope.id,
  }) <= 1;

/**
 * A field created or deleted changes the tab's layout: read it again, unless
 * a move is on its way (its answer brings the layout, and a read in between
 * could briefly put the old order back).
 */
const refreshLayouts = (queryClient: QueryClient) => {
  if (queryClient.isMutating({ predicate: (m) => m.options.scope?.id === LAYOUT_WRITE_SCOPE.id })) {
    return;
  }
  void queryClient.invalidateQueries({
    queryKey: orpc.dashboard.customerFields.layout.key(),
  });
};

const receiveList = (queryClient: QueryClient, list: CustomerFieldWithUsage[]) => {
  if (isLastQueuedWrite(queryClient, WRITE_SCOPE)) {
    queryClient.setQueryData<CustomerFieldWithUsage[]>(listKey(), list);
  }
};

export const customerFieldsMutations = {
  /** One or a few settings of a field; its row shows them at once. */
  update: (queryClient: QueryClient) =>
    orpc.dashboard.customerFields.update.mutationOptions({
      scope: WRITE_SCOPE,
      onMutate: async ({ id, ...patch }) => {
        await queryClient.cancelQueries({ queryKey: listKey() });
        const previous =
          queryClient
            .getQueryData<CustomerFieldWithUsage[]>(listKey())
            ?.find((field) => field.id === id) ?? null;
        queryClient.setQueryData<CustomerFieldWithUsage[]>(listKey(), (list) =>
          list?.map((field) => (field.id === id ? patchDefinition(field, patch) : field)),
        );
        return { previous };
      },
      onSuccess: (list) => receiveList(queryClient, list),
      onError: (_error, { id, ...patch }, context) => {
        const previous = context?.previous;
        if (!previous) return;
        queryClient.setQueryData<CustomerFieldWithUsage[]>(listKey(), (list) =>
          list?.map((field) =>
            field.id === id ? patchDefinition(field, revertPatch(previous, patch)) : field,
          ),
        );
      },
    }),

  create: (queryClient: QueryClient) =>
    orpc.dashboard.customerFields.create.mutationOptions({
      scope: WRITE_SCOPE,
      onSuccess: (list) => {
        receiveList(queryClient, list);
        refreshLayouts(queryClient);
      },
    }),

  adoptTemplate: (queryClient: QueryClient) =>
    orpc.dashboard.customerFields.adoptTemplate.mutationOptions({
      scope: WRITE_SCOPE,
      onSuccess: (list) => {
        receiveList(queryClient, list);
        refreshLayouts(queryClient);
      },
    }),

  remove: (queryClient: QueryClient) =>
    orpc.dashboard.customerFields.remove.mutationOptions({
      scope: WRITE_SCOPE,
      onSuccess: (list) => {
        receiveList(queryClient, list);
        refreshLayouts(queryClient);
      },
    }),

  /**
   * The order and widths of one tab. The caller has already put the new
   * order on screen (a drop must not flash back); this settles it with the
   * server's answer.
   */
  updateLayout: (queryClient: QueryClient) =>
    orpc.dashboard.customerFields.updateLayout.mutationOptions({
      scope: LAYOUT_WRITE_SCOPE,
      onMutate: async ({ scope }) => {
        await queryClient.cancelQueries({ queryKey: layoutKey(scope) });
      },
      onSuccess: (layout, { scope }) => {
        if (isLastQueuedWrite(queryClient, LAYOUT_WRITE_SCOPE)) {
          queryClient.setQueryData(layoutKey(scope), layout);
        }
      },
    }),

  /** One setting of a Louez profile field; its row and the checkout preview show it at once. */
  updateProfileField: (queryClient: QueryClient) =>
    orpc.dashboard.customerFields.updateProfileField.mutationOptions({
      scope: PROFILE_WRITE_SCOPE,
      onMutate: async ({ field, ...patch }) => {
        await queryClient.cancelQueries({ queryKey: profileKey() });
        const previous =
          queryClient.getQueryData<ResolvedCustomerProfileSettings>(profileKey())?.[field] ?? null;
        queryClient.setQueryData<ResolvedCustomerProfileSettings>(
          profileKey(),
          (settings) => settings && applyProfileFieldPatch(settings, field, patch),
        );
        return { previous };
      },
      onSuccess: (settings) => {
        if (isLastQueuedWrite(queryClient, PROFILE_WRITE_SCOPE)) {
          queryClient.setQueryData<ResolvedCustomerProfileSettings>(profileKey(), settings);
        }
      },
      onError: (_error, { field, ...patch }, context) => {
        const previous = context?.previous;
        if (!previous) return;
        queryClient.setQueryData<ResolvedCustomerProfileSettings>(
          profileKey(),
          (settings) => settings && revertProfileFieldPatch(settings, field, previous, patch),
        );
      },
    }),
};
