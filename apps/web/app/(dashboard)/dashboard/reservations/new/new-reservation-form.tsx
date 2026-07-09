'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

import { useStore } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enUS, fr } from 'date-fns/locale';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Calendar,
  Check,
  FileText,
  Loader2,
  PenLine,
  Plus,
  ShieldCheckIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import type { PricingMode, UnitAttributes } from '@louez/types';
import { toastManager } from '@louez/ui';
import { Button } from '@louez/ui';
import { Input } from '@louez/ui';
import { Textarea } from '@louez/ui';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui';
import { StepActions, StepContent, Stepper } from '@louez/ui';
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@louez/ui';
import { Label } from '@louez/ui';
import { Checkbox } from '@louez/ui';
import { cn, formatCurrency } from '@louez/utils';

import { invalidateReservationList } from '@/lib/orpc/invalidation';
import { orpc } from '@/lib/orpc/react';
import { formatStoreDate } from '@/lib/utils/store-date';

import { useAppForm } from '@/hooks/form/form';

import { useStoreTimezone } from '@/contexts/store-context';

import { getManualReservationAvailability } from '../actions';
import { NewReservationStepCustomer } from './components/new-reservation-step-customer';
import { NewReservationStepDelivery } from './components/new-reservation-step-delivery';
import { NewReservationStepProducts } from './components/new-reservation-step-products';
import { NewReservationStepReview } from './components/new-reservation-step-review';
import { useNewReservationDelivery } from './hooks/use-new-reservation-delivery';
import { useNewReservationPricing } from './hooks/use-new-reservation-pricing';
import { useNewReservationStepFlow } from './hooks/use-new-reservation-step-flow';
import {
  getPeriodAvailability,
  useNewReservationWarnings,
} from './hooks/use-new-reservation-warnings';
import type {
  CustomItem,
  NewReservationFormComponentApi,
  NewReservationFormProps,
  NewReservationFormValues,
  ProductPricingDetails,
  SelectedProduct,
  StepFieldName,
} from './types';
import { getLineQuantityConstraints } from './utils/variant-lines';

function createLineId() {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }

  return `line_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function pricingModeToBasePeriodMinutes(mode: PricingMode): number {
  if (mode === 'hour') return 60;
  if (mode === 'week') return 10080;
  return 1440;
}

type ManualReservationShortfall = {
  productId: string;
  productName: string;
  combinationKey: string | null;
  requested: number;
  available: number;
};

function isInsufficientCapacityResult(result: unknown): result is {
  error: 'errors.insufficientCapacity';
  shortfalls: ManualReservationShortfall[];
} {
  if (!result || typeof result !== 'object') {
    return false;
  }

  return (
    'error' in result &&
    result.error === 'errors.insufficientCapacity' &&
    'shortfalls' in result &&
    Array.isArray(result.shortfalls)
  );
}

export function NewReservationForm({
  customers,
  products,
  tulipInsuranceMode,
  businessHours,
  advanceNoticeMinutes = 0,
  pendingBlocksAvailability = true,
  turnoverBufferMinutes = 0,
  existingReservations = [],
  deliverySettings,
  storeLatitude,
  storeLongitude,
  storeAddress,
  storeLocations,
}: NewReservationFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const locale = useLocale();
  const timezone = useStoreTimezone();
  const t = useTranslations('dashboard.reservations.manualForm');
  const tCommon = useTranslations('common');
  const tErrors = useTranslations('errors');
  const tValidation = useTranslations('validation');

  const dateLocale = locale === 'fr' ? fr : enUS;
  const getTimeSlotsForDate = (
    date: Date | undefined,
  ): { minTime: string; maxTime: string } => {
    void date;
    return { minTime: '00:00', maxTime: '23:30' };
  };

  const [endDatePickerOpen, setEndDatePickerOpen] = useState(false);

  // Default time for new date selections: current time rounded up to next 30min slot
  const defaultTimeSlot = useMemo(() => {
    const now = new Date();
    const totalMinutes = now.getHours() * 60 + now.getMinutes();
    const rounded = Math.ceil(totalMinutes / 30) * 30;
    const h = Math.floor(rounded / 60);
    const m = rounded % 60;
    if (h >= 24) return '23:30';
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }, []);

  const [selectedProducts, setSelectedProducts] = useState<SelectedProduct[]>(
    [],
  );
  const [customItems, setCustomItems] = useState<CustomItem[]>([]);
  const [showCustomItemDialog, setShowCustomItemDialog] = useState(false);
  const [customItemForm, setCustomItemForm] = useState({
    name: '',
    description: '',
    unitPrice: '',
    totalPrice: '',
    deposit: '',
    quantity: '1',
    pricingMode: 'day' as PricingMode,
  });
  const [priceInputMode, setPriceInputMode] = useState<'unit' | 'total'>(
    'total',
  );
  const [sendConfirmationEmail, setSendConfirmationEmail] = useState(true);
  const sendAsQuoteRef = useRef(false);
  const [tulipInsuranceOptIn, setTulipInsuranceOptIn] = useState(
    tulipInsuranceMode === 'required' || tulipInsuranceMode === 'optional',
  );
  const [overbookingDialog, setOverbookingDialog] = useState<{
    isOpen: boolean;
    shortfalls: ManualReservationShortfall[];
  }>({
    isOpen: false,
    shortfalls: [],
  });

  const isDeliveryEnabled = Boolean(
    (deliverySettings?.enabled &&
      storeLatitude != null &&
      storeLongitude != null) ||
    deliverySettings?.multiLocationEnabled,
  );

  // Price override dialog state
  const [priceOverrideDialog, setPriceOverrideDialog] = useState<{
    isOpen: boolean;
    lineId: string | null;
    currentPrice: number;
    newPrice: string;
    pricingMode: PricingMode;
    duration: number;
  }>({
    isOpen: false,
    lineId: null,
    currentPrice: 0,
    newPrice: '',
    pricingMode: 'day',
    duration: 0,
  });

  const createReservationMutation = useMutation({
    ...orpc.dashboard.reservations.createManualReservation.mutationOptions({
      onSuccess: async () => {
        await invalidateReservationList(queryClient);
      },
    }),
  });

  const getActionErrorMessage = (error: unknown) => {
    if (error instanceof Error) {
      if (error.message.startsWith('errors.')) {
        return tErrors(error.message.replace('errors.', ''));
      }
      return error.message;
    }

    return tErrors('generic');
  };

  const getFieldErrorMessage = (error: unknown) => {
    if (typeof error === 'string' && error.length > 0) {
      return error;
    }

    if (
      typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      typeof error.message === 'string'
    ) {
      return error.message;
    }

    return tErrors('generic');
  };

  function validateCurrentStep(): boolean {
    let isValid = true;
    const stepId = currentStepId;

    switch (stepId) {
      case 'customer':
        if (watchCustomerType === 'existing') {
          clearStepFieldError('email');
          clearStepFieldError('firstName');
          clearStepFieldError('lastName');

          if (!watchCustomerId?.trim()) {
            setStepFieldError('customerId', tValidation('required'));
            isValid = false;
          } else {
            clearStepFieldError('customerId');
          }
        } else {
          clearStepFieldError('customerId');

          const { email, firstName, lastName } = watchedValues;

          if (!email?.trim()) {
            setStepFieldError('email', tValidation('required'));
            isValid = false;
          } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            setStepFieldError('email', tValidation('email'));
            isValid = false;
          } else {
            clearStepFieldError('email');
          }

          if (!firstName?.trim()) {
            setStepFieldError('firstName', tValidation('required'));
            isValid = false;
          } else {
            clearStepFieldError('firstName');
          }

          if (!lastName?.trim()) {
            setStepFieldError('lastName', tValidation('required'));
            isValid = false;
          } else {
            clearStepFieldError('lastName');
          }
        }

        if (!isValid) {
          toastManager.add({
            title: t('fillCustomerInfoError'),
            type: 'error',
          });
        }

        return isValid;
      case 'period':
        if (!watchStartDate) {
          setStepFieldError('startDate', tValidation('required'));
          isValid = false;
        } else {
          clearStepFieldError('startDate');
        }

        if (!watchEndDate) {
          setStepFieldError('endDate', tValidation('required'));
          isValid = false;
        } else if (watchStartDate && watchEndDate < watchStartDate) {
          setStepFieldError('endDate', tValidation('endDateBeforeStart'));
          isValid = false;
        } else {
          clearStepFieldError('endDate');
        }

        if (!isValid) {
          toastManager.add({ title: t('selectDatesError'), type: 'error' });
        }

        return isValid;
      case 'products':
        if (selectedProducts.length === 0 && customItems.length === 0) {
          toastManager.add({ title: t('addProductError'), type: 'error' });
          return false;
        }
        return true;
      case 'delivery':
        return delivery.canContinue;
      case 'confirm':
        return true;
      default:
        return true;
    }
  }

  const {
    steps,
    currentStep,
    currentStepId,
    stepDirection,
    goToNextStep,
    goToPreviousStep,
    goToStep,
  } = useNewReservationStepFlow({
    validateCurrentStep,
    isDeliveryEnabled,
  });

  const submitManualReservation = async (
    value: NewReservationFormValues,
    options: { allowOverbooking?: boolean } = {},
  ) => {
    if (!value.startDate || !value.endDate) {
      toastManager.add({ title: t('selectDatesError'), type: 'error' });
      return;
    }

    try {
      const effectiveTulipInsuranceOptIn =
        tulipInsuranceMode === 'required'
          ? true
          : tulipInsuranceMode === 'optional'
            ? tulipInsuranceOptIn
            : false;

      const result = await createReservationMutation.mutateAsync({
        payload: {
          customerId:
            value.customerType === 'existing' ? value.customerId : undefined,
          newCustomer:
            value.customerType === 'new'
              ? {
                  email: value.email.trim().toLowerCase(),
                  firstName: value.firstName,
                  lastName: value.lastName,
                  phone: value.phone || undefined,
                }
              : undefined,
          startDate: value.startDate,
          endDate: value.endDate,
          items: selectedProducts,
          customItems: customItems.map((item) => ({
            name: item.name,
            description: item.description,
            unitPrice: item.unitPrice,
            deposit: item.deposit,
            quantity: item.quantity,
            pricingMode: item.pricingMode,
          })),
          delivery: {
            outbound:
              delivery.outboundMethod === 'address' &&
              delivery.outboundAddress.latitude !== null &&
              delivery.outboundAddress.longitude !== null
                ? {
                    method: 'address' as const,
                    address: delivery.outboundAddress.address,
                    city: delivery.outboundAddress.city,
                    postalCode: delivery.outboundAddress.postalCode,
                    country: delivery.outboundAddress.country,
                    latitude: delivery.outboundAddress.latitude,
                    longitude: delivery.outboundAddress.longitude,
                  }
                : {
                    method: 'store' as const,
                    locationId: delivery.pickupLocationId,
                  },
            return:
              delivery.returnMethod === 'address' &&
              delivery.returnAddress.latitude !== null &&
              delivery.returnAddress.longitude !== null
                ? {
                    method: 'address' as const,
                    address: delivery.returnAddress.address,
                    city: delivery.returnAddress.city,
                    postalCode: delivery.returnAddress.postalCode,
                    country: delivery.returnAddress.country,
                    latitude: delivery.returnAddress.latitude,
                    longitude: delivery.returnAddress.longitude,
                  }
                : {
                    method: 'store' as const,
                    locationId: delivery.returnLocationId,
                  },
          },
          internalNotes: value.internalNotes || undefined,
          tulipInsuranceOptIn: effectiveTulipInsuranceOptIn,
          sendConfirmationEmail: sendAsQuoteRef.current
            ? true
            : sendConfirmationEmail,
          sendAsQuote: sendAsQuoteRef.current,
          allowOverbooking: options.allowOverbooking,
        },
      });

      if (isInsufficientCapacityResult(result)) {
        setOverbookingDialog({
          isOpen: true,
          shortfalls: result.shortfalls,
        });
        return;
      }

      if ('error' in result && result.error) {
        toastManager.add({
          title: tErrors(result.error.replace('errors.', '')),
          type: 'error',
        });
        return;
      }

      toastManager.add({
        title: sendAsQuoteRef.current
          ? t('quoteSent')
          : t('reservationCreated'),
        type: 'success',
      });
      router.push(`/dashboard/reservations/${result.reservationId}`);
    } catch (error) {
      toastManager.add({
        title: getActionErrorMessage(error),
        type: 'error',
      });
    }
  };

  const form = useAppForm({
    defaultValues: {
      customerType: (customers.length > 0 ? 'existing' : 'new') as
        | 'existing'
        | 'new',
      customerId: '',
      email: '',
      firstName: '',
      lastName: '',
      phone: '',
      startDate: undefined as Date | undefined,
      endDate: undefined as Date | undefined,
      internalNotes: '',
    },
    onSubmit: async ({ value }) => {
      if (currentStep !== steps.length - 1) {
        return;
      }

      if (!validateCurrentStep()) return;

      await submitManualReservation(value);
    },
  });

  const watchCustomerType = useStore(
    form.store,
    (s) => s.values.customerType as NewReservationFormValues['customerType'],
  );
  const watchCustomerId = useStore(form.store, (s) => s.values.customerId);
  const watchStartDate = useStore(
    form.store,
    (s) => s.values.startDate as Date | undefined,
  );
  const watchEndDate = useStore(
    form.store,
    (s) => s.values.endDate as Date | undefined,
  );
  const watchedValues = useStore(
    form.store,
    (s) => s.values as NewReservationFormValues,
  );
  const isSaving = createReservationMutation.isPending;

  const selectedCustomer = customers.find((c) => c.id === watchCustomerId);
  const hasSelectedPeriod = Boolean(watchStartDate && watchEndDate);
  const availabilityProductIds = useMemo(
    () => products.map((product) => product.id),
    [products],
  );
  const manualAvailabilityQuery = useQuery({
    queryKey: [
      'manual-reservation-availability',
      watchStartDate?.toISOString() ?? null,
      watchEndDate?.toISOString() ?? null,
      availabilityProductIds,
    ],
    queryFn: async () => {
      if (!watchStartDate || !watchEndDate) {
        return null;
      }

      const result = await getManualReservationAvailability({
        startDate: watchStartDate.toISOString(),
        endDate: watchEndDate.toISOString(),
        productIds: availabilityProductIds,
      });

      if (!result.success) {
        throw new Error(result.error ?? 'errors.invalidData');
      }

      return result.availability.products;
    },
    enabled: hasSelectedPeriod,
    staleTime: 30_000,
  });
  const serviceAvailability =
    manualAvailabilityQuery.data && !manualAvailabilityQuery.isError
      ? manualAvailabilityQuery.data
      : undefined;

  const { periodWarnings, availabilityWarnings } = useNewReservationWarnings({
    startDate: watchStartDate,
    endDate: watchEndDate,
    selectedProducts,
    products,
    businessHours,
    advanceNoticeMinutes,
    pendingBlocksAvailability,
    turnoverBufferMinutes,
    existingReservations,
    serviceAvailability,
  });
  const periodAvailability = useMemo(
    () =>
      getPeriodAvailability({
        startDate: watchStartDate,
        endDate: watchEndDate,
        pendingBlocksAvailability,
        turnoverBufferMinutes,
        existingReservations,
        serviceAvailability,
      }),
    [
      existingReservations,
      pendingBlocksAvailability,
      serviceAvailability,
      turnoverBufferMinutes,
      watchEndDate,
      watchStartDate,
    ],
  );
  const getPeriodProductAvailability = useCallback(
    (productId: string) => periodAvailability.productsById.get(productId),
    [periodAvailability],
  );

  const {
    calculateDurationForMode,
    duration,
    detailedDuration,
    hasItems,
    subtotal,
    originalSubtotal,
    deposit,
    totalSavings,
    getProductPricingDetails,
    getCustomItemTotal,
  } = useNewReservationPricing({
    startDate: watchStartDate,
    endDate: watchEndDate,
    selectedProducts,
    customItems,
    products,
  });

  const effectiveTulipInsuranceOptInForPreview =
    tulipInsuranceMode === 'required'
      ? true
      : tulipInsuranceMode === 'optional'
        ? tulipInsuranceOptIn
        : false;
  const tulipInsuranceQuoteItems = useMemo(
    () =>
      selectedProducts
        .filter((item) => item.productId && item.quantity > 0)
        .map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
    [selectedProducts],
  );
  const tulipInsuranceQuoteRequest = useMemo(() => {
    if (
      !effectiveTulipInsuranceOptInForPreview ||
      !watchStartDate ||
      !watchEndDate ||
      watchEndDate < watchStartDate ||
      tulipInsuranceQuoteItems.length === 0
    ) {
      return null;
    }

    const basePayload = {
      startDate: watchStartDate.toISOString(),
      endDate: watchEndDate.toISOString(),
      tulipInsuranceOptIn: true,
      items: tulipInsuranceQuoteItems,
    };

    if (watchCustomerType === 'existing') {
      if (!watchCustomerId?.trim()) {
        return null;
      }

      return {
        ...basePayload,
        customerId: watchCustomerId,
      };
    }

    const email = watchedValues.email?.trim() ?? '';
    const firstName = watchedValues.firstName?.trim() ?? '';
    const lastName = watchedValues.lastName?.trim() ?? '';
    const phone = watchedValues.phone?.trim() ?? '';

    if (
      !email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !firstName ||
      !lastName
    ) {
      return null;
    }

    return {
      ...basePayload,
      newCustomer: {
        email,
        firstName,
        lastName,
        ...(phone && { phone }),
      },
    };
  }, [
    effectiveTulipInsuranceOptInForPreview,
    tulipInsuranceQuoteItems,
    watchCustomerId,
    watchCustomerType,
    watchEndDate,
    watchStartDate,
    watchedValues.email,
    watchedValues.firstName,
    watchedValues.lastName,
    watchedValues.phone,
  ]);
  const tulipInsuranceQuoteInput = {
    payload:
      tulipInsuranceQuoteRequest ??
      ({
        startDate: (watchStartDate ?? new Date()).toISOString(),
        endDate: (watchEndDate ?? watchStartDate ?? new Date()).toISOString(),
        tulipInsuranceOptIn: false,
        items: [],
      } as const),
  };
  const tulipInsuranceQuoteQuery = useQuery({
    ...orpc.dashboard.reservations.previewManualTulipQuote.queryOptions({
      input: tulipInsuranceQuoteInput,
    }),
    enabled: tulipInsuranceQuoteRequest !== null,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const isTulipInsuranceQuoteLoading =
    tulipInsuranceQuoteRequest !== null &&
    (tulipInsuranceQuoteQuery.isLoading ||
      (tulipInsuranceQuoteQuery.isFetching && !tulipInsuranceQuoteQuery.data));
  const tulipInsuranceQuotePreview = tulipInsuranceQuoteQuery.data;
  const isTulipInsuranceApplied =
    effectiveTulipInsuranceOptInForPreview &&
    tulipInsuranceQuotePreview?.appliedOptIn === true;
  const tulipInsuranceAmount =
    isTulipInsuranceApplied && tulipInsuranceQuotePreview.amount > 0
      ? tulipInsuranceQuotePreview.amount
      : 0;
  const tulipInsuranceQuoteErrorKey = tulipInsuranceQuoteQuery.isError
    ? 'errors.tulipQuoteFailed'
    : (tulipInsuranceQuotePreview?.quoteError ?? null);
  const tulipInsuranceQuoteErrorMessage = tulipInsuranceQuoteErrorKey
    ? tErrors(tulipInsuranceQuoteErrorKey.replace('errors.', ''))
    : null;
  const delivery = useNewReservationDelivery({
    deliverySettings,
    storeLatitude,
    storeLongitude,
    subtotal: subtotal + tulipInsuranceAmount,
  });

  const addProduct = (productId: string) => {
    const product = products.find((item) => item.id === productId);
    if (!product) {
      return;
    }

    const bookingAttributeAxes = product.bookingAttributeAxes || [];
    const supportsOptionLines =
      product.trackUnits && bookingAttributeAxes.length > 0;

    setSelectedProducts((prev) => {
      if (supportsOptionLines) {
        const nextLine: SelectedProduct = {
          lineId: createLineId(),
          productId,
          quantity: 1,
        };
        const productLines = [
          ...prev.filter((line) => line.productId === productId),
          nextLine,
        ];
        const constraints = getLineQuantityConstraints(
          product,
          nextLine,
          productLines,
          periodAvailability.reservedByProduct.get(product.id) || 0,
          periodAvailability.reservedByProductCombination,
          hasSelectedPeriod,
          getPeriodProductAvailability(product.id),
        );
        if (constraints.lineMaxQuantity <= 0) {
          return prev;
        }

        return [...prev, nextLine];
      }

      const existingLine = prev.find((line) => line.productId === productId);
      if (!existingLine) {
        const nextLine: SelectedProduct = {
          lineId: createLineId(),
          productId,
          quantity: 1,
        };
        const constraints = getLineQuantityConstraints(
          product,
          nextLine,
          [nextLine],
          periodAvailability.reservedByProduct.get(product.id) || 0,
          periodAvailability.reservedByProductCombination,
          hasSelectedPeriod,
          getPeriodProductAvailability(product.id),
        );
        if (constraints.lineMaxQuantity <= 0) {
          return prev;
        }

        return [...prev, nextLine];
      }

      const productLines = prev.filter((line) => line.productId === productId);
      const constraints = getLineQuantityConstraints(
        product,
        existingLine,
        productLines,
        periodAvailability.reservedByProduct.get(product.id) || 0,
        periodAvailability.reservedByProductCombination,
        hasSelectedPeriod,
        getPeriodProductAvailability(product.id),
      );
      const nextQuantity = Math.min(
        existingLine.quantity + 1,
        Math.max(existingLine.quantity, constraints.lineMaxQuantity),
      );

      return prev.map((line) => {
        if (line.lineId !== existingLine.lineId) {
          return line;
        }

        return {
          ...line,
          quantity: nextQuantity,
        };
      });
    });
  };

  const updateQuantity = (lineId: string, delta: number) => {
    setSelectedProducts((prev) => {
      const currentLine = prev.find((line) => line.lineId === lineId);
      if (!currentLine) {
        return prev;
      }

      if (delta < 0 && currentLine.quantity + delta <= 0) {
        return prev.filter((line) => line.lineId !== lineId);
      }

      const product = products.find(
        (item) => item.id === currentLine.productId,
      );
      if (!product) {
        return prev;
      }

      const productLines = prev.filter(
        (line) => line.productId === currentLine.productId,
      );
      const constraints = getLineQuantityConstraints(
        product,
        currentLine,
        productLines,
        periodAvailability.reservedByProduct.get(product.id) || 0,
        periodAvailability.reservedByProductCombination,
        hasSelectedPeriod,
        getPeriodProductAvailability(product.id),
      );
      const nextQuantity = Math.max(
        1,
        Math.min(
          currentLine.quantity + delta,
          Math.max(1, constraints.lineMaxQuantity),
        ),
      );

      if (nextQuantity === currentLine.quantity) {
        return prev;
      }

      return prev.map((line) => {
        if (line.lineId !== lineId) {
          return line;
        }

        return {
          ...line,
          quantity: nextQuantity,
        };
      });
    });
  };

  const updateSelectedAttributes = (
    lineId: string,
    axisKey: string,
    value: string | undefined,
  ) => {
    setSelectedProducts((prev) => {
      const currentLine = prev.find((line) => line.lineId === lineId);
      if (!currentLine) {
        return prev;
      }

      const product = products.find(
        (item) => item.id === currentLine.productId,
      );
      if (!product) {
        return prev;
      }

      const nextAttributes: UnitAttributes = {
        ...currentLine.selectedAttributes,
      };

      if (!value || value === '__none__') {
        delete nextAttributes[axisKey];
      } else {
        nextAttributes[axisKey] = value;
      }

      const nextLine: SelectedProduct = {
        ...currentLine,
        selectedAttributes:
          Object.keys(nextAttributes).length > 0 ? nextAttributes : undefined,
      };

      const productLines = prev
        .filter((line) => line.productId === currentLine.productId)
        .map((line) => (line.lineId === lineId ? nextLine : line));
      const constraints = getLineQuantityConstraints(
        product,
        nextLine,
        productLines,
        periodAvailability.reservedByProduct.get(product.id) || 0,
        periodAvailability.reservedByProductCombination,
        hasSelectedPeriod,
        getPeriodProductAvailability(product.id),
      );
      const nextQuantity = Math.min(
        nextLine.quantity,
        constraints.lineMaxQuantity,
      );

      const normalizedLine: SelectedProduct =
        nextQuantity > 0
          ? {
              ...nextLine,
              quantity: Math.max(1, nextQuantity),
            }
          : {
              ...nextLine,
              quantity: 0,
            };

      return prev
        .map((line) => (line.lineId === lineId ? normalizedLine : line))
        .filter((line) => line.quantity > 0);
    });
  };

  const removeSelectedProductLine = (lineId: string) => {
    setSelectedProducts((prev) =>
      prev.filter((line) => line.lineId !== lineId),
    );
  };

  const updateProductTotalPrice = (
    lineId: string,
    totalPrice: number,
    pricing: ProductPricingDetails,
  ) => {
    setSelectedProducts((prev) =>
      prev.map((line) => {
        if (line.lineId !== lineId) return line;

        const divisor = pricing.productDuration * line.quantity;
        const unitPrice = divisor > 0 ? totalPrice / divisor : totalPrice;
        if (Math.abs(unitPrice - pricing.calculatedPrice) < 0.01) {
          const nextLine = { ...line };
          delete nextLine.priceOverride;
          return nextLine;
        }

        return { ...line, priceOverride: { unitPrice } };
      }),
    );
  };

  // Custom item management
  const resetCustomItemForm = () => {
    setCustomItemForm({
      name: '',
      description: '',
      unitPrice: '',
      totalPrice: '',
      deposit: '',
      quantity: '1',
      pricingMode: 'day',
    });
  };

  const customItemDuration =
    watchStartDate && watchEndDate
      ? calculateDurationForMode(
          watchStartDate,
          watchEndDate,
          customItemForm.pricingMode,
        )
      : 0;

  // Calculate unit price from total price
  const calculateUnitPriceFromTotal = (totalPrice: string, qty: string) => {
    const total = parseFloat(totalPrice);
    const quantity = parseInt(qty) || 1;
    if (isNaN(total) || total <= 0 || customItemDuration <= 0) return '';
    return (total / (quantity * customItemDuration)).toFixed(2);
  };

  // Calculate total price from unit price
  const calculateTotalFromUnitPrice = (unitPrice: string, qty: string) => {
    const unit = parseFloat(unitPrice);
    const quantity = parseInt(qty) || 1;
    if (isNaN(unit) || unit <= 0 || customItemDuration <= 0) return '';
    return (unit * quantity * customItemDuration).toFixed(2);
  };

  // Handle unit price change
  const handleUnitPriceChange = (value: string) => {
    const quantity = customItemForm.quantity;
    setCustomItemForm({
      ...customItemForm,
      unitPrice: value,
      totalPrice: calculateTotalFromUnitPrice(value, quantity),
    });
  };

  // Handle total price change
  const handleTotalPriceChange = (value: string) => {
    const quantity = customItemForm.quantity;
    setCustomItemForm({
      ...customItemForm,
      totalPrice: value,
      unitPrice: calculateUnitPriceFromTotal(value, quantity),
    });
  };

  // Handle quantity change for custom item form
  const handleCustomItemQuantityChange = (value: string) => {
    if (priceInputMode === 'total') {
      // Recalculate unit price based on total
      setCustomItemForm({
        ...customItemForm,
        quantity: value,
        unitPrice: calculateUnitPriceFromTotal(
          customItemForm.totalPrice,
          value,
        ),
      });
    } else {
      // Recalculate total based on unit price
      setCustomItemForm({
        ...customItemForm,
        quantity: value,
        totalPrice: calculateTotalFromUnitPrice(
          customItemForm.unitPrice,
          value,
        ),
      });
    }
  };

  const handleAddCustomItem = () => {
    let unitPrice: number;

    if (priceInputMode === 'total') {
      // Calculate unit price from total
      const totalPrice = parseFloat(customItemForm.totalPrice);
      const quantity = parseInt(customItemForm.quantity) || 1;
      if (isNaN(totalPrice) || totalPrice <= 0) {
        toastManager.add({
          title: t('customItem.priceRequired'),
          type: 'error',
        });
        return;
      }
      if (customItemDuration <= 0) {
        toastManager.add({
          title: t('customItem.selectPeriodFirst'),
          type: 'error',
        });
        return;
      }
      unitPrice = totalPrice / (quantity * customItemDuration);
    } else {
      unitPrice = parseFloat(customItemForm.unitPrice);
      if (isNaN(unitPrice) || unitPrice <= 0) {
        toastManager.add({
          title: t('customItem.priceRequired'),
          type: 'error',
        });
        return;
      }
    }

    const deposit = parseFloat(customItemForm.deposit) || 0;
    const quantity = parseInt(customItemForm.quantity) || 1;

    if (!customItemForm.name.trim()) {
      toastManager.add({ title: t('customItem.nameRequired'), type: 'error' });
      return;
    }

    const newItem: CustomItem = {
      id: `custom-${Date.now()}`,
      name: customItemForm.name.trim(),
      description: customItemForm.description.trim(),
      unitPrice,
      deposit,
      quantity,
      pricingMode: customItemForm.pricingMode,
      basePeriodMinutes: pricingModeToBasePeriodMinutes(
        customItemForm.pricingMode,
      ),
    };

    setCustomItems([...customItems, newItem]);
    resetCustomItemForm();
    setShowCustomItemDialog(false);
    toastManager.add({ title: t('customItem.added'), type: 'success' });
  };

  const updateCustomItemQuantity = (id: string, delta: number) => {
    setCustomItems(
      customItems
        .map((item) => {
          if (item.id === id) {
            const newQuantity = item.quantity + delta;
            return newQuantity > 0 ? { ...item, quantity: newQuantity } : null;
          }
          return item;
        })
        .filter(Boolean) as CustomItem[],
    );
  };

  const removeCustomItem = (id: string) => {
    setCustomItems(customItems.filter((item) => item.id !== id));
  };

  const updateCustomItemTotalPrice = (id: string, totalPrice: number) => {
    setCustomItems((prev) =>
      prev.map((item) => {
        if (item.id !== id || !watchStartDate || !watchEndDate) return item;

        const itemDuration = calculateDurationForMode(
          watchStartDate,
          watchEndDate,
          item.pricingMode,
        );
        const divisor = itemDuration * item.quantity;
        const unitPrice = divisor > 0 ? totalPrice / divisor : totalPrice;

        return { ...item, unitPrice };
      }),
    );
  };

  // Price override functions
  const openPriceOverrideDialog = (
    lineId: string,
    calculatedPrice: number,
    pricingMode: PricingMode,
    duration: number,
  ) => {
    const existingOverride = selectedProducts.find(
      (line) => line.lineId === lineId,
    )?.priceOverride;
    setPriceOverrideDialog({
      isOpen: true,
      lineId,
      currentPrice: calculatedPrice,
      newPrice: existingOverride
        ? existingOverride.unitPrice.toString()
        : calculatedPrice.toString(),
      pricingMode,
      duration,
    });
  };

  const closePriceOverrideDialog = () => {
    setPriceOverrideDialog({
      isOpen: false,
      lineId: null,
      currentPrice: 0,
      newPrice: '',
      pricingMode: 'day',
      duration: 0,
    });
  };

  const applyPriceOverride = () => {
    if (!priceOverrideDialog.lineId) return;

    const newPrice = parseFloat(priceOverrideDialog.newPrice);
    if (isNaN(newPrice)) {
      toastManager.add({ title: t('customItem.priceRequired'), type: 'error' });
      return;
    }

    setSelectedProducts((prev) =>
      prev.map((line) => {
        if (line.lineId === priceOverrideDialog.lineId) {
          // Si le nouveau prix est égal au prix calculé, on supprime l'override
          if (Math.abs(newPrice - priceOverrideDialog.currentPrice) < 0.01) {
            const nextLine = { ...line };
            delete nextLine.priceOverride;
            return nextLine;
          }
          return { ...line, priceOverride: { unitPrice: newPrice } };
        }
        return line;
      }),
    );

    toastManager.add({
      title: t('priceOverride.priceUpdated'),
      type: 'success',
    });
    closePriceOverrideDialog();
  };

  const setStepFieldError = (name: StepFieldName, message: string) => {
    form.setFieldMeta(name, (prev) => ({
      ...prev,
      isTouched: true,
      errorMap: {
        ...prev?.errorMap,
        onSubmit: message,
      },
    }));
  };

  const clearStepFieldError = (name: StepFieldName) => {
    form.setFieldMeta(name, (prev) => ({
      ...prev,
      errorMap: {
        ...prev?.errorMap,
        onSubmit: undefined,
      },
    }));
  };

  const getPricingUnitLabel = useCallback(
    (mode: PricingMode) => {
      if (mode === 'hour') return t('perHour');
      if (mode === 'week') return t('perWeek');
      return t('perDay');
    },
    [t],
  );

  return (
    <>
      <form.AppForm>
        <form.Form className="space-y-6 pb-28">
          {/* Stepper */}
          <Card>
            <CardContent className="pt-6">
              <Stepper
                steps={steps}
                currentStep={currentStep}
                onStepClick={goToStep}
              />
            </CardContent>
          </Card>
          {/* <Stepper
              steps={steps}
              currentStep={currentStep}
              onStepClick={goToStep}
            /> */}

          {/* Step: Customer */}
          {currentStepId === 'customer' && (
            <StepContent direction={stepDirection}>
              <NewReservationStepCustomer
                form={form as unknown as NewReservationFormComponentApi}
                customers={customers}
                customerType={watchCustomerType}
                clearStepFieldError={clearStepFieldError}
                getFieldErrorMessage={getFieldErrorMessage}
              />
            </StepContent>
          )}

          {/* Step: Period */}
          {currentStepId === 'period' && (
            <StepContent direction={stepDirection}>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    {t('period')}
                  </CardTitle>
                  <CardDescription>
                    {t('periodStepDescription')}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-6 sm:grid-cols-2">
                    <form.AppField name="startDate">
                      {(field) => {
                        const timeSlots = getTimeSlotsForDate(
                          field.state.value,
                        );
                        return (
                          <field.ReservationDatePicker
                            id="reservation-start-date"
                            label={t('startDate')}
                            minTime={timeSlots.minTime}
                            maxTime={timeSlots.maxTime}
                            timezone={timezone}
                            autoCloseOnTimeSelect
                            onChange={() => clearStepFieldError('startDate')}
                            onAutoClose={() => {
                              // Small delay to let the start popover close before opening end.
                              setTimeout(() => setEndDatePickerOpen(true), 150);
                            }}
                            defaultTime={defaultTimeSlot}
                          />
                        );
                      }}
                    </form.AppField>
                    <form.AppField name="endDate">
                      {(field) => {
                        const timeSlots = getTimeSlotsForDate(
                          field.state.value,
                        );
                        return (
                          <field.ReservationDatePicker
                            id="reservation-end-date"
                            label={t('endDate')}
                            disabledDates={(date) => {
                              // Only block dates before start date (logical constraint).
                              if (watchStartDate) {
                                const startDay = new Date(watchStartDate);
                                startDay.setHours(0, 0, 0, 0);
                                return date < startDay;
                              }
                              return false;
                            }}
                            minTime={timeSlots.minTime}
                            maxTime={timeSlots.maxTime}
                            timezone={timezone}
                            referenceDate={watchStartDate}
                            autoCloseOnTimeSelect
                            open={endDatePickerOpen}
                            onOpenChange={setEndDatePickerOpen}
                            onChange={() => clearStepFieldError('endDate')}
                            defaultTime={defaultTimeSlot}
                          />
                        );
                      }}
                    </form.AppField>
                  </div>

                  {watchStartDate && watchEndDate && duration > 0 && (
                    <div className="mt-6 space-y-2.5">
                      <div className="bg-card relative flex items-center justify-between gap-3 rounded-xl border px-4 py-3 sm:gap-4">
                        <div className="min-w-0">
                          <p className="text-xs font-medium tabular-nums">
                            {formatStoreDate(
                              watchStartDate,
                              timezone,
                              'd MMM yyyy',
                            )}
                          </p>
                          <p className="text-muted-foreground text-[11px] tabular-nums">
                            {formatStoreDate(watchStartDate, timezone, 'HH:mm')}
                          </p>
                        </div>

                        {detailedDuration && (
                          <span className="bg-card max-w-20 shrink-0 rounded-full border px-2 py-0.5 text-center text-[11px] leading-tight font-semibold text-balance tabular-nums sm:hidden">
                            {[
                              detailedDuration.days > 0 &&
                                `${detailedDuration.days} ${tCommon('dayUnit', { count: detailedDuration.days })}`,
                              detailedDuration.hours > 0 &&
                                `${detailedDuration.hours}h`,
                              detailedDuration.minutes > 0 &&
                                `${detailedDuration.minutes} min`,
                            ]
                              .filter(Boolean)
                              .join(' · ') || `0 min`}
                          </span>
                        )}

                        <div className="relative hidden h-3 flex-1 items-center justify-between sm:flex">
                          <div className="timeline-dash-flow absolute inset-x-0 top-1/2 h-px -translate-y-1/2" />
                          <div className="relative h-2 w-2 shrink-0">
                            <span className="bg-primary timeline-dot-pulse absolute inset-0 rounded-full" />
                            <span className="bg-primary ring-primary/15 relative block h-2 w-2 rounded-full ring-[3px]" />
                          </div>
                          <div className="relative h-2 w-2 shrink-0">
                            <span className="bg-primary timeline-dot-pulse absolute inset-0 rounded-full [animation-delay:1.2s]" />
                            <span className="bg-primary ring-primary/15 relative block h-2 w-2 rounded-full ring-[3px]" />
                          </div>
                          {detailedDuration && (
                            <span className="bg-card absolute top-1/2 left-1/2 max-w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border px-2 py-0.5 text-center text-[11px] leading-tight font-semibold text-balance tabular-nums">
                              {[
                                detailedDuration.days > 0 &&
                                  `${detailedDuration.days} ${tCommon('dayUnit', { count: detailedDuration.days })}`,
                                detailedDuration.hours > 0 &&
                                  `${detailedDuration.hours}h`,
                                detailedDuration.minutes > 0 &&
                                  `${detailedDuration.minutes} min`,
                              ]
                                .filter(Boolean)
                                .join(' · ') || `0 min`}
                            </span>
                          )}
                        </div>

                        <div className="min-w-0 text-right">
                          <p className="text-xs font-medium tabular-nums">
                            {formatStoreDate(
                              watchEndDate,
                              timezone,
                              'd MMM yyyy',
                            )}
                          </p>
                          <p className="text-muted-foreground text-[11px] tabular-nums">
                            {formatStoreDate(watchEndDate, timezone, 'HH:mm')}
                          </p>
                        </div>
                      </div>

                      {periodWarnings.length > 0 && (
                        <div className="space-y-1.5">
                          {periodWarnings.map((warning, index) => (
                            <div
                              key={`${warning.type}-${warning.field}-${index}`}
                              className="bg-warning/10 flex items-start gap-2.5 rounded-lg px-3 py-2"
                            >
                              <AlertTriangle className="text-warning mt-0.5 h-3.5 w-3.5 shrink-0" />
                              <div className="min-w-0 space-y-0.5">
                                <p className="text-foreground text-xs font-medium">
                                  {warning.message}
                                </p>
                                {warning.details && (
                                  <p className="text-muted-foreground text-[11px]">
                                    {warning.details}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                          <p className="text-muted-foreground flex items-center gap-1.5 px-1 pt-1 text-[11px]">
                            <ShieldCheckIcon className="h-3 w-3" />
                            {t('warnings.canContinue')}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </StepContent>
          )}

          {/* Step: Products */}
          {currentStepId === 'products' && (
            <StepContent direction={stepDirection}>
              <NewReservationStepProducts
                products={products}
                selectedProducts={selectedProducts}
                customItems={customItems}
                tulipInsuranceMode={tulipInsuranceMode}
                tulipInsuranceOptIn={tulipInsuranceOptIn}
                tulipInsuranceAmount={tulipInsuranceAmount}
                isTulipInsuranceQuoteLoading={isTulipInsuranceQuoteLoading}
                tulipInsuranceQuoteErrorMessage={
                  tulipInsuranceQuoteErrorMessage
                }
                startDate={watchStartDate}
                endDate={watchEndDate}
                availabilityWarnings={availabilityWarnings}
                periodAvailability={periodAvailability}
                hasSelectedPeriod={hasSelectedPeriod}
                hasItems={hasItems}
                subtotal={subtotal}
                originalSubtotal={originalSubtotal}
                totalSavings={totalSavings}
                deposit={deposit}
                addProduct={addProduct}
                updateQuantity={updateQuantity}
                updateSelectedAttributes={updateSelectedAttributes}
                removeSelectedProductLine={removeSelectedProductLine}
                onOpenCustomItemDialog={() => setShowCustomItemDialog(true)}
                updateCustomItemQuantity={updateCustomItemQuantity}
                removeCustomItem={removeCustomItem}
                onTulipInsuranceOptInChange={setTulipInsuranceOptIn}
                openPriceOverrideDialog={openPriceOverrideDialog}
                calculateDurationForMode={calculateDurationForMode}
                getProductPricingDetails={getProductPricingDetails}
                getCustomItemTotal={getCustomItemTotal}
              />
            </StepContent>
          )}

          {/* Step: Delivery (conditional) */}
          {currentStepId === 'delivery' && deliverySettings && (
            <StepContent direction={stepDirection}>
              <NewReservationStepDelivery
                deliverySettings={deliverySettings}
                subtotal={subtotal + tulipInsuranceAmount}
                currency="EUR"
                storeAddress={storeAddress}
                locations={storeLocations}
                isDeliveryForced={delivery.isDeliveryForced}
                isDeliveryIncluded={delivery.isDeliveryIncluded}
                outboundMethod={delivery.outboundMethod}
                pickupLocationId={delivery.pickupLocationId}
                outboundAddress={delivery.outboundAddress}
                outboundDistance={delivery.outboundDistance}
                outboundFee={delivery.outboundFee}
                outboundError={delivery.outboundError}
                onOutboundMethodChange={delivery.handleOutboundMethodChange}
                onPickupLocationChange={delivery.handlePickupLocationChange}
                onOutboundAddressChange={delivery.handleOutboundAddressChange}
                returnMethod={delivery.returnMethod}
                returnLocationId={delivery.returnLocationId}
                returnAddress={delivery.returnAddress}
                returnDistance={delivery.returnDistance}
                returnFee={delivery.returnFee}
                returnError={delivery.returnError}
                onReturnMethodChange={delivery.handleReturnMethodChange}
                onReturnLocationChange={delivery.handleReturnLocationChange}
                onReturnAddressChange={delivery.handleReturnAddressChange}
                totalFee={delivery.totalFee}
              />
            </StepContent>
          )}

          {/* Step: Confirmation */}
          {currentStepId === 'confirm' && (
            <StepContent direction={stepDirection}>
              <NewReservationStepReview
                form={form as unknown as NewReservationFormComponentApi}
                customerType={watchCustomerType}
                selectedCustomer={selectedCustomer}
                values={watchedValues}
                startDate={watchStartDate}
                endDate={watchEndDate}
                duration={duration}
                detailedDuration={detailedDuration}
                locale={locale}
                dateLocale={dateLocale}
                selectedProducts={selectedProducts}
                customItems={customItems}
                products={products}
                tulipInsuranceMode={tulipInsuranceMode}
                tulipInsuranceOptIn={tulipInsuranceOptIn}
                isTulipInsuranceApplied={isTulipInsuranceApplied}
                tulipInsuranceAmount={tulipInsuranceAmount}
                isTulipInsuranceQuoteLoading={isTulipInsuranceQuoteLoading}
                tulipInsuranceQuoteErrorMessage={
                  tulipInsuranceQuoteErrorMessage
                }
                subtotal={subtotal}
                deposit={deposit}
                getProductPricingDetails={getProductPricingDetails}
                getCustomItemTotal={getCustomItemTotal}
                onProductTotalChange={updateProductTotalPrice}
                onCustomItemTotalChange={updateCustomItemTotalPrice}
                hasDeliveryLegs={
                  delivery.outboundMethod === 'address' ||
                  delivery.returnMethod === 'address'
                }
                deliveryFee={delivery.totalFee}
                isDeliveryIncluded={delivery.isDeliveryIncluded}
                outboundMethod={delivery.outboundMethod}
                outboundAddress={delivery.outboundAddress}
                outboundDistance={delivery.outboundDistance}
                returnMethod={delivery.returnMethod}
                returnAddress={delivery.returnAddress}
                returnDistance={delivery.returnDistance}
                storeAddress={storeAddress}
              />
            </StepContent>
          )}

          {/* Navigation */}
          <StepActions
            position="fixed"
            className={cn(
              'lg:left-64',
              currentStep === steps.length - 1 &&
                'flex-col items-stretch sm:flex-row sm:items-center',
            )}
          >
            <div
              className={cn(
                currentStep === steps.length - 1 &&
                  'flex items-center gap-3 sm:shrink-0',
              )}
            >
              {currentStep > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={goToPreviousStep}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {tCommon('previous')}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push('/dashboard/reservations')}
                >
                  {tCommon('cancel')}
                </Button>
              )}

              {currentStep === steps.length - 1 && (
                <div className="flex min-w-0 flex-1 items-center space-x-2 sm:hidden">
                  <Checkbox
                    id="sendConfirmationEmailMobile"
                    checked={sendConfirmationEmail}
                    onCheckedChange={(checked) =>
                      setSendConfirmationEmail(checked === true)
                    }
                  />
                  <label
                    htmlFor="sendConfirmationEmailMobile"
                    className="text-muted-foreground min-w-0 cursor-pointer text-sm leading-tight"
                  >
                    {t('sendConfirmationEmail')}
                  </label>
                </div>
              )}
            </div>

            <div
              className={cn(
                'flex items-center gap-3',
                currentStep === steps.length - 1 &&
                  'grid min-w-0 grid-cols-2 items-stretch sm:flex sm:items-center sm:justify-end',
              )}
            >
              {currentStep < steps.length - 1 ? (
                <Button type="button" onClick={goToNextStep}>
                  {tCommon('next')}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              ) : (
                <>
                  <div className="hidden min-w-0 flex-1 items-center space-x-2 sm:flex sm:max-w-48">
                    <Checkbox
                      id="sendConfirmationEmail"
                      checked={sendConfirmationEmail}
                      onCheckedChange={(checked) =>
                        setSendConfirmationEmail(checked === true)
                      }
                    />
                    <label
                      htmlFor="sendConfirmationEmail"
                      className="text-muted-foreground min-w-0 cursor-pointer text-sm leading-tight"
                    >
                      {t('sendConfirmationEmail')}
                    </label>
                  </div>
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={isSaving}
                    onClick={() => {
                      sendAsQuoteRef.current = true;
                    }}
                    className="min-w-0 flex-1 sm:w-auto sm:flex-none"
                  >
                    {isSaving && sendAsQuoteRef.current ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <FileText className="mr-2 h-4 w-4" />
                    )}
                    {t('sendAsQuote')}
                  </Button>
                  <Button
                    type="submit"
                    disabled={isSaving}
                    onClick={() => {
                      sendAsQuoteRef.current = false;
                    }}
                    className="min-w-0 flex-1 sm:w-auto sm:flex-none"
                  >
                    {isSaving && !sendAsQuoteRef.current ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="mr-2 h-4 w-4" />
                    )}
                    {t('create')}
                  </Button>
                </>
              )}
            </div>
          </StepActions>
        </form.Form>
      </form.AppForm>

      {/* Custom Item Dialog */}
      <Dialog
        open={showCustomItemDialog}
        onOpenChange={setShowCustomItemDialog}
      >
        <DialogPopup className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PenLine className="h-5 w-5" />
              {t('customItem.dialogTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('customItem.dialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="custom-name">{t('customItem.name')} *</Label>
                <Input
                  id="custom-name"
                  placeholder={t('customItem.namePlaceholder')}
                  value={customItemForm.name}
                  onChange={(e) =>
                    setCustomItemForm({
                      ...customItemForm,
                      name: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="custom-description">
                  {t('customItem.description')}
                </Label>
                <Textarea
                  id="custom-description"
                  placeholder={t('customItem.descriptionPlaceholder')}
                  value={customItemForm.description}
                  onChange={(e) =>
                    setCustomItemForm({
                      ...customItemForm,
                      description: e.target.value,
                    })
                  }
                  className="resize-none"
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="custom-quantity">
                    {t('customItem.quantity')}
                  </Label>
                  <Input
                    id="custom-quantity"
                    type="number"
                    min="1"
                    value={customItemForm.quantity}
                    onChange={(e) =>
                      handleCustomItemQuantityChange(e.target.value)
                    }
                    className="w-full"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="custom-deposit">
                    {t('customItem.deposit')}
                  </Label>
                  <div className="relative">
                    <Input
                      id="custom-deposit"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={customItemForm.deposit}
                      onChange={(e) =>
                        setCustomItemForm({
                          ...customItemForm,
                          deposit: e.target.value,
                        })
                      }
                      className="pr-8"
                    />
                    <span className="text-muted-foreground absolute top-1/2 right-3 -translate-y-1/2 text-sm">
                      €
                    </span>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="custom-pricing-mode">
                  {t('customItem.pricingPeriod')}
                </Label>
                <Select
                  value={customItemForm.pricingMode}
                  onValueChange={(value) =>
                    setCustomItemForm({
                      ...customItemForm,
                      pricingMode: value as PricingMode,
                    })
                  }
                >
                  <SelectTrigger id="custom-pricing-mode">
                    <SelectValue>
                      {customItemForm.pricingMode === 'hour' && t('perHour')}
                      {customItemForm.pricingMode === 'day' && t('perDay')}
                      {customItemForm.pricingMode === 'week' && 'week'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hour" label={t('perHour')}>
                      {t('perHour')}
                    </SelectItem>
                    <SelectItem value="day" label={t('perDay')}>
                      {t('perDay')}
                    </SelectItem>
                    <SelectItem value="week" label="week">
                      week
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {customItemDuration > 0 && (
                <div className="bg-muted/30 space-y-3 rounded-lg border p-3">
                  <div className="text-muted-foreground flex items-center justify-between text-sm">
                    <span>{t('customItem.pricingPeriod')}</span>
                    <span className="text-foreground font-medium">
                      {customItemDuration}{' '}
                      {customItemForm.pricingMode === 'hour'
                        ? 'h'
                        : customItemForm.pricingMode === 'week'
                          ? 'sem'
                          : 'j'}{' '}
                      × {customItemForm.quantity || 1} unité(s)
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="custom-total" className="text-xs">
                        {t('customItem.totalPrice')} *
                      </Label>
                      <div className="relative">
                        <Input
                          id="custom-total"
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          value={customItemForm.totalPrice}
                          onChange={(e) =>
                            handleTotalPriceChange(e.target.value)
                          }
                          onFocus={() => setPriceInputMode('total')}
                          className="pr-8"
                        />
                        <span className="text-muted-foreground absolute top-1/2 right-3 -translate-y-1/2 text-sm">
                          €
                        </span>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="custom-unit" className="text-xs">
                        {t('customItem.unitPrice')}
                      </Label>
                      <div className="relative">
                        <Input
                          id="custom-unit"
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          value={customItemForm.unitPrice}
                          onChange={(e) =>
                            handleUnitPriceChange(e.target.value)
                          }
                          onFocus={() => setPriceInputMode('unit')}
                          className="pr-12"
                        />
                        <span className="text-muted-foreground absolute top-1/2 right-3 -translate-y-1/2 text-sm">
                          €/
                          {customItemForm.pricingMode === 'hour'
                            ? t('perHour')
                            : customItemForm.pricingMode === 'week'
                              ? 'week'
                              : t('perDay')}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {customItemDuration === 0 && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-600 dark:border-amber-800 dark:bg-amber-950/30">
                  {t('customItem.selectPeriodFirst')}
                </p>
              )}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                resetCustomItemForm();
                setShowCustomItemDialog(false);
              }}
            >
              {tCommon('cancel')}
            </Button>
            <Button type="button" onClick={handleAddCustomItem}>
              <Plus className="mr-1 h-4 w-4" />
              {t('customItem.addButton')}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      {/* Price Override Dialog */}
      <Dialog
        open={priceOverrideDialog.isOpen}
        onOpenChange={(open) => !open && closePriceOverrideDialog()}
      >
        <DialogPopup className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PenLine className="h-5 w-5" />
              {t('priceOverride.dialogTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('priceOverride.dialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-4">
              {/* Display calculated price for reference */}
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {t('priceOverride.calculatedPrice')}
                  </span>
                  <span className="font-medium">
                    {formatCurrency(priceOverrideDialog.currentPrice)}/
                    {getPricingUnitLabel(priceOverrideDialog.pricingMode)}
                  </span>
                </div>
              </div>

              {/* New price input */}
              <div className="space-y-2">
                <Label htmlFor="override-price">
                  {t('priceOverride.newPrice')} *
                </Label>
                <div className="relative">
                  <Input
                    id="override-price"
                    type="number"
                    step="0.01"
                    placeholder={t('priceOverride.newPricePlaceholder')}
                    value={priceOverrideDialog.newPrice}
                    onChange={(e) =>
                      setPriceOverrideDialog({
                        ...priceOverrideDialog,
                        newPrice: e.target.value,
                      })
                    }
                    className="pr-12"
                    autoFocus
                  />
                  <span className="text-muted-foreground absolute top-1/2 right-3 -translate-y-1/2 text-sm">
                    €/{getPricingUnitLabel(priceOverrideDialog.pricingMode)}
                  </span>
                </div>
              </div>

              {/* Total preview */}
              {priceOverrideDialog.duration > 0 &&
                priceOverrideDialog.newPrice && (
                  <div className="rounded-lg border p-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        {t('priceOverride.totalForPeriod')}
                      </span>
                      <span className="font-medium">
                        {formatCurrency(
                          parseFloat(priceOverrideDialog.newPrice || '0') *
                            priceOverrideDialog.duration,
                        )}
                      </span>
                    </div>
                    {priceOverrideDialog.currentPrice !==
                      parseFloat(priceOverrideDialog.newPrice || '0') && (
                      <div className="mt-1 flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                          vs.{' '}
                          {formatCurrency(
                            priceOverrideDialog.currentPrice *
                              priceOverrideDialog.duration,
                          )}
                        </span>
                        <span
                          className={cn(
                            parseFloat(priceOverrideDialog.newPrice || '0') <
                              priceOverrideDialog.currentPrice
                              ? 'text-green-600'
                              : 'text-orange-600',
                          )}
                        >
                          {parseFloat(priceOverrideDialog.newPrice || '0') <
                          priceOverrideDialog.currentPrice
                            ? `-${formatCurrency((priceOverrideDialog.currentPrice - parseFloat(priceOverrideDialog.newPrice || '0')) * priceOverrideDialog.duration)}`
                            : `+${formatCurrency((parseFloat(priceOverrideDialog.newPrice || '0') - priceOverrideDialog.currentPrice) * priceOverrideDialog.duration)}`}
                        </span>
                      </div>
                    )}
                  </div>
                )}
            </div>
          </DialogPanel>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPriceOverrideDialog({
                  ...priceOverrideDialog,
                  newPrice: priceOverrideDialog.currentPrice.toString(),
                });
              }}
              className="sm:mr-auto"
            >
              {t('priceOverride.reset')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={closePriceOverrideDialog}
            >
              {tCommon('cancel')}
            </Button>
            <Button type="button" onClick={applyPriceOverride}>
              {t('priceOverride.apply')}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog
        open={overbookingDialog.isOpen}
        onOpenChange={(open) =>
          setOverbookingDialog((current) => ({
            ...current,
            isOpen: open,
          }))
        }
      >
        <DialogPopup className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="text-destructive h-5 w-5" />
              {t('overbooking.title')}
            </DialogTitle>
            <DialogDescription>
              {t('overbooking.description')}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-2">
              {overbookingDialog.shortfalls.map((shortfall) => (
                <div
                  key={`${shortfall.productId}:${shortfall.combinationKey || 'product'}`}
                  className="rounded-md border p-3"
                >
                  <p className="text-sm font-medium">{shortfall.productName}</p>
                  {shortfall.combinationKey && (
                    <p className="text-muted-foreground mt-1 text-xs">
                      {t('overbooking.combination', {
                        combination: shortfall.combinationKey,
                      })}
                    </p>
                  )}
                  <p className="text-muted-foreground mt-1 text-sm">
                    {t('overbooking.shortfall', {
                      requested: shortfall.requested,
                      available: shortfall.available,
                    })}
                  </p>
                </div>
              ))}
            </div>
          </DialogPanel>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setOverbookingDialog({ isOpen: false, shortfalls: [] })
              }
            >
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isSaving}
              onClick={async () => {
                setOverbookingDialog({ isOpen: false, shortfalls: [] });
                await submitManualReservation(watchedValues, {
                  allowOverbooking: true,
                });
              }}
            >
              {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('overbooking.createAnyway')}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
