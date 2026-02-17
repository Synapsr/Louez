import { ORPCError } from '@orpc/server'
import {
  dashboardIntegrationsCreateTulipProductInputSchema,
  dashboardIntegrationsConnectTulipInputSchema,
  dashboardIntegrationsDisconnectTulipInputSchema,
  dashboardIntegrationsGetTulipStateInputSchema,
  dashboardIntegrationsPushTulipProductUpdateInputSchema,
  dashboardIntegrationsUpdateTulipConfigurationInputSchema,
  dashboardIntegrationsUpsertTulipProductMappingInputSchema,
} from '@louez/validations'

import { dashboardProcedure, requirePermission } from '../../procedures'
import { toORPCError } from '../../utils/orpc-error'

const getTulipState = dashboardProcedure
  .input(dashboardIntegrationsGetTulipStateInputSchema)
  .handler(async ({ context }) => {
    try {
      const fn = context.dashboardIntegrationActions?.getTulipIntegrationState

      if (!fn) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'dashboardIntegrationActions.getTulipIntegrationState not provided',
        })
      }

      const result = await fn()
      if ('error' in result && result.error) {
        throw new ORPCError('BAD_REQUEST', { message: result.error })
      }

      return result
    } catch (error) {
      throw toORPCError(error)
    }
  })

const connectTulip = requirePermission('write')
  .input(dashboardIntegrationsConnectTulipInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardIntegrationActions?.connectTulipApiKey

      if (!fn) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'dashboardIntegrationActions.connectTulipApiKey not provided',
        })
      }

      const result = await fn(input)
      if (result.error) {
        throw new ORPCError('BAD_REQUEST', { message: result.error })
      }

      return { success: true as const }
    } catch (error) {
      throw toORPCError(error)
    }
  })

const updateTulipConfiguration = requirePermission('write')
  .input(dashboardIntegrationsUpdateTulipConfigurationInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardIntegrationActions?.updateTulipConfiguration

      if (!fn) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'dashboardIntegrationActions.updateTulipConfiguration not provided',
        })
      }

      const result = await fn(input)
      if (result.error) {
        throw new ORPCError('BAD_REQUEST', { message: result.error })
      }

      return { success: true as const }
    } catch (error) {
      throw toORPCError(error)
    }
  })

const upsertTulipProductMapping = requirePermission('write')
  .input(dashboardIntegrationsUpsertTulipProductMappingInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardIntegrationActions?.upsertTulipProductMapping

      if (!fn) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'dashboardIntegrationActions.upsertTulipProductMapping not provided',
        })
      }

      const result = await fn(input)
      if (result.error) {
        throw new ORPCError('BAD_REQUEST', { message: result.error })
      }

      return { success: true as const }
    } catch (error) {
      throw toORPCError(error)
    }
  })

const pushTulipProductUpdate = requirePermission('write')
  .input(dashboardIntegrationsPushTulipProductUpdateInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardIntegrationActions?.pushTulipProductUpdate

      if (!fn) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'dashboardIntegrationActions.pushTulipProductUpdate not provided',
        })
      }

      const result = await fn(input)
      if (result.error) {
        throw new ORPCError('BAD_REQUEST', { message: result.error })
      }

      return { success: true as const }
    } catch (error) {
      throw toORPCError(error)
    }
  })

const createTulipProduct = requirePermission('write')
  .input(dashboardIntegrationsCreateTulipProductInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardIntegrationActions?.createTulipProduct

      if (!fn) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'dashboardIntegrationActions.createTulipProduct not provided',
        })
      }

      const result = await fn(input)
      if (result.error) {
        throw new ORPCError('BAD_REQUEST', { message: result.error })
      }

      return { success: true as const }
    } catch (error) {
      throw toORPCError(error)
    }
  })

const disconnectTulip = requirePermission('write')
  .input(dashboardIntegrationsDisconnectTulipInputSchema)
  .handler(async ({ context }) => {
    try {
      const fn = context.dashboardIntegrationActions?.disconnectTulip

      if (!fn) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'dashboardIntegrationActions.disconnectTulip not provided',
        })
      }

      const result = await fn()
      if (result.error) {
        throw new ORPCError('BAD_REQUEST', { message: result.error })
      }

      return { success: true as const }
    } catch (error) {
      throw toORPCError(error)
    }
  })

export const dashboardIntegrationsRouter = {
  getTulipState,
  connectTulip,
  disconnectTulip,
  updateTulipConfiguration,
  upsertTulipProductMapping,
  pushTulipProductUpdate,
  createTulipProduct,
}
