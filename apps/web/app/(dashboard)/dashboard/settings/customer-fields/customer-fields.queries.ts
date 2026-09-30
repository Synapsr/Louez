import type { QueryClient } from "@tanstack/react-query";

import type { ResolvedCustomerProfileSettings } from "@louez/types";

import { orpc } from "@/lib/orpc/react";

import {
  type CustomerFieldWithUsage,
  applyReorder,
  applySectionRename,
  patchDefinition,
  revertPatch,
} from "./util.customer-fields-builder";
import {
  applyProfileFieldPatch,
  revertProfileFieldPatch,
} from "./util.customer-profile-field-settings";

/**
 * Every write of the editor answers with the whole list. They run one after
 * the other (a mutation scope), so answers arrive in order; while several are
 * queued, only the last one's answer replaces the list, and the earlier
 * optimistic changes are not flashed away in between.
 */
const WRITE_SCOPE = { id: "settings-customer-fields" };

/** The same, for the Louez profile fields: each write answers with their three settings. */
const PROFILE_WRITE_SCOPE = { id: "settings-customer-profile-fields" };

export const customerFieldsListOptions = () => orpc.dashboard.customerFields.list.queryOptions();

export const customerProfileSettingsOptions = () =>
  orpc.dashboard.customerFields.profileSettings.queryOptions();

const listKey = () => customerFieldsListOptions().queryKey;

const profileKey = () => customerProfileSettingsOptions().queryKey;

const isLastQueuedWrite = (queryClient: QueryClient, scope: { id: string }) =>
  queryClient.isMutating({
    predicate: (mutation) => mutation.options.scope?.id === scope.id,
  }) <= 1;

const receiveList = (queryClient: QueryClient, list: CustomerFieldWithUsage[]) => {
  if (isLastQueuedWrite(queryClient, WRITE_SCOPE)) {
    queryClient.setQueryData<CustomerFieldWithUsage[]>(listKey(), list);
  }
};

/** Shows a change before the server confirms it; the answer or a revert settles it. */
const patchList = async (
  queryClient: QueryClient,
  update: (list: CustomerFieldWithUsage[]) => CustomerFieldWithUsage[],
) => {
  await queryClient.cancelQueries({ queryKey: listKey() });
  queryClient.setQueryData<CustomerFieldWithUsage[]>(listKey(), (list) => list && update(list));
};

export const customerFieldsMutations = {
  /** One or a few settings of a field; the canvas shows them at once. */
  update: (queryClient: QueryClient) =>
    orpc.dashboard.customerFields.update.mutationOptions({
      scope: WRITE_SCOPE,
      onMutate: async ({ id, ...patch }) => {
        const previous =
          queryClient
            .getQueryData<CustomerFieldWithUsage[]>(listKey())
            ?.find((field) => field.id === id) ?? null;
        await patchList(queryClient, (list) =>
          list.map((field) => (field.id === id ? patchDefinition(field, patch) : field)),
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
      onSuccess: (list) => receiveList(queryClient, list),
    }),

  adoptTemplate: (queryClient: QueryClient) =>
    orpc.dashboard.customerFields.adoptTemplate.mutationOptions({
      scope: WRITE_SCOPE,
      onSuccess: (list) => receiveList(queryClient, list),
    }),

  reorder: (queryClient: QueryClient) =>
    orpc.dashboard.customerFields.reorder.mutationOptions({
      scope: WRITE_SCOPE,
      onMutate: async ({ fields }) => {
        const previous = queryClient.getQueryData<CustomerFieldWithUsage[]>(listKey());
        await patchList(queryClient, (list) => applyReorder(list, fields));
        return { previous };
      },
      onSuccess: (list) => receiveList(queryClient, list),
      onError: (_error, _input, context) => {
        if (context?.previous) {
          queryClient.setQueryData<CustomerFieldWithUsage[]>(listKey(), context.previous);
        }
      },
    }),

  renameSection: (queryClient: QueryClient) =>
    orpc.dashboard.customerFields.renameSection.mutationOptions({
      scope: WRITE_SCOPE,
      onMutate: async ({ from, to }) => {
        const previous = queryClient.getQueryData<CustomerFieldWithUsage[]>(listKey());
        await patchList(queryClient, (list) => applySectionRename(list, from, to));
        return { previous };
      },
      onSuccess: (list) => receiveList(queryClient, list),
      onError: (_error, _input, context) => {
        if (context?.previous) {
          queryClient.setQueryData<CustomerFieldWithUsage[]>(listKey(), context.previous);
        }
      },
    }),

  updateSectionOnline: (queryClient: QueryClient) =>
    orpc.dashboard.customerFields.updateSectionOnline.mutationOptions({
      scope: WRITE_SCOPE,
      onSuccess: (list) => receiveList(queryClient, list),
    }),

  remove: (queryClient: QueryClient) =>
    orpc.dashboard.customerFields.remove.mutationOptions({
      scope: WRITE_SCOPE,
      onSuccess: (list) => receiveList(queryClient, list),
    }),

  /** One setting of a Louez profile field; the canvas and the checkout preview show it at once. */
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
