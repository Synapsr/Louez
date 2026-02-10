---
title: Migration Guide — react-hook-form to TanStack Form
description: Step-by-step guide to migrate React forms from react-hook-form to @tanstack/react-form with Zod validation.
---

# Migrating from react-hook-form to TanStack Form

This guide walks you through migrating an existing React project from `react-hook-form` (RHF) to `@tanstack/react-form` with Zod validation, using a scalable architecture based on form hooks and registered components.

## Why migrate?

| | react-hook-form | TanStack Form |
|---|---|---|
| **API style** | Imperative (`register`, `setValue`, `getValues`) | Declarative (render-prop fields, reactive subscriptions) |
| **Validation** | Resolver-based (external adapters) | First-class validators (onChange, onBlur, onSubmit, async) |
| **Type safety** | Good, but requires generic wiring | End-to-end inference from `defaultValues` |
| **Reusable fields** | Manual context wiring | Built-in `createFormHook` with component registration |
| **Framework support** | React only | React, Vue, Solid, Lit, Angular |
| **Bundle size** | ~13 kB | ~7 kB |

---

## Table of Contents

1. [Install dependencies](#1-install-dependencies)
2. [Set up the form hook architecture](#2-set-up-the-form-hook-architecture)
3. [Create field components](#3-create-field-components)
4. [Create the form wrapper](#4-create-the-form-wrapper)
5. [Migrate forms one by one](#5-migrate-forms-one-by-one)
6. [Validation migration](#6-validation-migration)
7. [Side-by-side API comparison](#7-side-by-side-api-comparison)
8. [Advanced patterns](#8-advanced-patterns)
9. [Checklist](#9-checklist)

---

## 1. Install dependencies

```bash
# Remove react-hook-form and its Zod resolver
npm uninstall react-hook-form @hookform/resolvers

# Install TanStack Form
npm install @tanstack/react-form
```

Zod stays — TanStack Form supports it natively without an adapter.

---

## 2. Set up the form hook architecture

TanStack Form's `createFormHook` lets you register reusable field and form components once, then use them across all forms. This replaces the pattern of manually wiring `register()` or `Controller` on every field.

### 2a. Create form contexts

```tsx
// src/hooks/form/form-context.tsx
import { createFormHookContexts } from "@tanstack/react-form";

export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();
```

### 2b. Create the form hook

```tsx
// src/hooks/form/form.tsx
import { createFormHook } from "@tanstack/react-form";
import { fieldContext, formContext } from "./form-context";
import { FormInput } from "@/components/form/form-input";
import { FormTextarea } from "@/components/form/form-textarea";
import { FormForm } from "@/components/form/form-form";

export const { useAppForm, withForm } = createFormHook({
  fieldComponents: {
    Input: FormInput,
    Textarea: FormTextarea,
    // Register more field types as needed
  },
  formComponents: {
    Form: FormForm,
    SubscribeButton, // see below
  },
  fieldContext,
  formContext,
});

export type AppForm = ReturnType<typeof useAppForm>;
```

### 2c. Create a SubscribeButton

This replaces the pattern of manually checking `formState.isSubmitting`:

```tsx
// Inside src/hooks/form/form.tsx
import { useStore } from "@tanstack/react-form";

function SubscribeButton({
  children,
  isDefaultValueDisabled = false,
  ...props
}: React.ComponentProps<"button"> & {
  isDefaultValueDisabled?: boolean;
}) {
  const form = useFormContext();

  const isSubmitting = useStore(form.store, (s) => s.isSubmitting);
  const isDisabled = isDefaultValueDisabled
    ? useStore(form.store, (s) => !s.isDirty || s.isSubmitting)
    : isSubmitting;

  return (
    <button
      type="button"
      disabled={isDisabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // Defer so pending state updates flush before submit
        queueMicrotask(() => form.handleSubmit());
      }}
      {...props}
    >
      {isSubmitting ? "Submitting..." : children}
    </button>
  );
}
```

---

## 3. Create field components

Each field component receives its state through `useFieldContext()` instead of RHF's `register()` or `Controller`.

### Before (react-hook-form)

```tsx
// Typical RHF field
function InputField({ name, label, control, ...props }) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <div>
          <label>{label}</label>
          <input {...field} {...props} />
          {fieldState.error && <p className="text-red-500">{fieldState.error.message}</p>}
        </div>
      )}
    />
  );
}
```

### After (TanStack Form)

```tsx
// src/components/form/form-input.tsx
import { useFieldContext } from "@/hooks/form/form-context";
import { useStore } from "@tanstack/react-form";

export function FormInput({
  label,
  ...props
}: { label?: string } & React.ComponentProps<"input">) {
  const field = useFieldContext<string>();

  const errors = useStore(field.store, (s) => s.meta.errors);

  return (
    <div className="space-y-2">
      {label && <label htmlFor={field.name}>{label}</label>}
      <input
        id={field.name}
        name={field.name}
        value={field.state.value}
        onChange={(e) => field.handleChange(e.target.value)}
        onBlur={field.handleBlur}
        {...props}
      />
      {errors.length > 0 && (
        <p className="text-sm text-red-500">{String(errors[0])}</p>
      )}
    </div>
  );
}
```

The key difference: no `name` prop or `control` prop needed. The context provides everything.

---

## 4. Create the form wrapper

### Before (react-hook-form)

```tsx
<form onSubmit={handleSubmit(onSubmit)}>
  {children}
</form>
```

### After (TanStack Form)

```tsx
// src/components/form/form-form.tsx
import { useFormContext } from "@/hooks/form/form-context";

export function FormForm({
  children,
  ...props
}: React.ComponentProps<"form">) {
  const form = useFormContext();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      {...props}
    >
      {children}
    </form>
  );
}
```

---

## 5. Migrate forms one by one

### Before (react-hook-form)

```tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const schema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "Min 8 characters"),
});

type FormData = z.infer<typeof schema>;

function LoginForm() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (data: FormData) => {
    await loginMutation(data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label>Email</label>
        <input {...register("email")} type="email" placeholder="john@example.com" />
        {errors.email && <p className="text-red-500">{errors.email.message}</p>}
      </div>

      <div>
        <label>Password</label>
        <input {...register("password")} type="password" />
        {errors.password && <p className="text-red-500">{errors.password.message}</p>}
      </div>

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
```

### After (TanStack Form)

```tsx
import { useAppForm } from "@/hooks/form/form";
import { revalidateLogic } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

const schema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "Min 8 characters"),
});

function LoginForm() {
  const mutation = useMutation({
    mutationFn: async (value: { email: string; password: string }) => {
      return await loginApi(value);
    },
    onError: (error) => toast.error(error.message),
    onSuccess: () => navigate("/dashboard"),
  });

  const form = useAppForm({
    defaultValues: { email: "", password: "" },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync(value);
    },
    validationLogic: revalidateLogic({
      mode: "submit",              // validate on submit initially
      modeAfterSubmission: "change", // then on every change
    }),
    validators: {
      onSubmit: schema,
    },
  });

  return (
    <form.AppForm>
      <form.Form className="space-y-4">
        <form.AppField name="email">
          {(field) => (
            <field.Input label="Email" type="email" placeholder="john@example.com" />
          )}
        </form.AppField>

        <form.AppField name="password">
          {(field) => (
            <field.Input label="Password" type="password" />
          )}
        </form.AppField>

        <form.SubscribeButton type="submit">Sign in</form.SubscribeButton>
      </form.Form>
    </form.AppForm>
  );
}
```

---

## 6. Validation migration

### Resolver → native validators

| react-hook-form | TanStack Form |
|---|---|
| `resolver: zodResolver(schema)` | `validators: { onChange: schema }` |
| `resolver: zodResolver(schema)` (submit only) | `validators: { onSubmit: schema }` |
| Custom `validate` fn on field | `validators: { onChange: ({ value }) => ... }` |
| No built-in per-event control | `revalidateLogic()` for submit-then-change |

### Recommended validation pattern

Use `revalidateLogic` for the best UX — quiet until first submit, then real-time:

```tsx
const form = useAppForm({
  validationLogic: revalidateLogic({
    mode: "submit",
    modeAfterSubmission: "change",
  }),
  validators: {
    onSubmit: schema,
  },
});
```

This replaces the common RHF pattern of `mode: "onSubmit"` + `reValidateMode: "onChange"`.

### Async validation

```tsx
// Before (RHF) — custom validate in Controller
<Controller
  name="username"
  rules={{
    validate: async (value) => {
      const exists = await checkUsername(value);
      return exists ? "Username taken" : true;
    },
  }}
/>

// After (TanStack Form) — onSubmitAsync at form level
const form = useAppForm({
  validators: {
    onChange: schema,
    onSubmitAsync: async ({ value }) => {
      const exists = await checkUsername(value.username);
      if (exists) return { fields: { username: "Username taken" } };
      return undefined;
    },
  },
});
```

---

## 7. Side-by-side API comparison

| Task | react-hook-form | TanStack Form |
|---|---|---|
| Create form | `useForm({ defaultValues })` | `useAppForm({ defaultValues })` |
| Register field | `register("name")` | `<form.AppField name="name">` |
| Controlled field | `<Controller name control render>` | `<form.AppField name>{(field) => ...}` |
| Get field value | `watch("name")` / `getValues("name")` | `useStore(form.store, s => s.values.name)` |
| Set field value | `setValue("name", value)` | `form.setFieldValue("name", value)` |
| Get errors | `formState.errors.name?.message` | `field.state.meta.errors` |
| Set server error | `setError("name", { message })` | `form.setFieldMeta("name", prev => ({ ...prev, errors: ["msg"] }))` |
| Check dirty | `formState.isDirty` | `useStore(form.store, s => s.isDirty)` |
| Check submitting | `formState.isSubmitting` | `useStore(form.store, s => s.isSubmitting)` |
| Reset form | `reset()` | `form.reset()` |
| Submit handler | `handleSubmit(onSubmit)` | `form.handleSubmit()` with `onSubmit` in config |
| Validation | `resolver: zodResolver(schema)` | `validators: { onSubmit: schema }` |
| Field arrays | `useFieldArray({ control, name })` | `<form.Field name="items" mode="array">` |

---

## 8. Advanced patterns

### Server-side error handling

```tsx
// Set an error on a specific field after a failed API call
onSubmit: async ({ value }) => {
  try {
    await createItem({ name: value.name });
    form.reset();
  } catch (error) {
    if (error instanceof Error && error.message.includes("DUPLICATE")) {
      form.setFieldMeta("name", (prev) => ({
        ...prev,
        errors: ["An item with this name already exists"],
      }));
    }
    throw error;
  }
},
```

### Mutations with TanStack Query

Always wrap async operations in `useMutation` — don't put API calls directly in `onSubmit`:

```tsx
const mutation = useMutation({
  mutationFn: async (value: FormValues) => {
    return await api.createItem(value);
  },
  onError: (error) => toast.error(error.message),
  onSuccess: () => {
    form.reset();
    queryClient.invalidateQueries({ queryKey: ["items"] });
  },
});

const form = useAppForm({
  defaultValues: { name: "" },
  onSubmit: async ({ value }) => {
    await mutation.mutateAsync(value);
  },
});
```

### Conditional/dynamic fields

```tsx
// RHF: conditional rendering with watch()
const type = watch("type");
{type === "business" && <input {...register("company")} />}

// TanStack Form: subscribe to field value
<form.Subscribe selector={(s) => s.values.type}>
  {(type) =>
    type === "business" && (
      <form.AppField name="company">
        {(field) => <field.Input label="Company" />}
      </form.AppField>
    )
  }
</form.Subscribe>
```

### Render props (custom field markup)

When you need full control instead of using a registered component:

```tsx
<form.Field name="email">
  {(field) => (
    <div>
      <label htmlFor={field.name}>Email</label>
      <input
        id={field.name}
        value={field.state.value}
        onChange={(e) => field.handleChange(e.target.value)}
        onBlur={field.handleBlur}
      />
      {field.state.meta.errors.map((error, i) => (
        <p key={i} className="text-sm text-red-500">{String(error)}</p>
      ))}
    </div>
  )}
</form.Field>
```

Use `form.Field` (render props) for one-off custom layouts. Use `form.AppField` (registered components) for repeated patterns.

---

## 9. Checklist

Use this checklist to track migration progress per form:

- [ ] Install `@tanstack/react-form`, remove `react-hook-form` + `@hookform/resolvers`
- [ ] Create `form-context.tsx` with `createFormHookContexts()`
- [ ] Create `form.tsx` with `createFormHook()` and register components
- [ ] Create `FormForm` wrapper component
- [ ] Create `FormInput` field component (and other field types as needed)
- [ ] Create `SubscribeButton` component
- [ ] Migrate each form:
  - [ ] Replace `useForm()` with `useAppForm()`
  - [ ] Replace `resolver: zodResolver(schema)` with `validators: { onSubmit: schema }`
  - [ ] Replace `register("name")` / `<Controller>` with `<form.AppField>`
  - [ ] Replace `handleSubmit(onSubmit)` with `onSubmit` in form config
  - [ ] Replace `formState.isSubmitting` checks with `SubscribeButton`
  - [ ] Replace `setError()` with `form.setFieldMeta()`
  - [ ] Wrap async operations in `useMutation`
  - [ ] Add `revalidateLogic()` for submit-then-change UX
- [ ] Remove `react-hook-form` from `package.json`
- [ ] Search codebase for remaining `react-hook-form` imports

---

## File structure

After migration, your form infrastructure should look like this:

```
src/
  hooks/form/
    form.tsx              # useAppForm, SubscribeButton, AppForm type
    form-context.tsx      # fieldContext, formContext from createFormHookContexts
  components/form/
    form-form.tsx         # <form> wrapper routing submit to handleSubmit()
    form-input.tsx        # Text input field component
    form-textarea.tsx     # Textarea field component
    form-select.tsx       # Select field component
    form-checkbox.tsx     # Checkbox field component
    ...                   # Add more as needed
```

To add a new field type, create the component and register it in `form.tsx` under `fieldComponents`. It will then be available on every `<form.AppField>` render prop.
