---
title: Form Handling
description: Build forms in React using TanStack Form, Zod, and our custom form hook.
links:
  doc: https://tanstack.com/form
---

# Form Handling

This guide documents how forms are built in Louez using TanStack Form.

## Architecture

Forms use a layered architecture:

1. **`@tanstack/react-form`** — headless form state, validation, submission
2. **`useAppForm` hook** — project-level wrapper that registers reusable field/form components
3. **Field components** (`@/components/form/*`) — UI components wired to form context (label, error display, validation)
4. **Zod** — schema-based client-side validation

```
hooks/form/
  form.tsx            # useAppForm, withForm, SubscribeButton
  form-context.tsx    # fieldContext, formContext (from createFormHookContexts)

components/form/
  form-input.tsx      # Input field with label + error display
  form-form.tsx       # <form> wrapper that routes submit to form.handleSubmit()
```

## Before You Start

### Adding a new form

1. Define a Zod schema for validation.
2. Call `useAppForm()` with `defaultValues`, `validators`, and `onSubmit`.
3. Wrap fields in `<form.AppForm>` and `<form.Form>`.
4. Use `<form.AppField>` with registered field components, or `<form.Field>` with render props for custom markup.
5. Use `<form.SubscribeButton>` for the submit button.

### Adding a new field component

If you need a field type that doesn't exist yet (e.g. textarea, select, checkbox):

1. Create the component at `@/components/form/form-<type>.tsx` following the pattern in `form-input.tsx`.
2. Register it in `@/hooks/form/form.tsx` under `fieldComponents`.

## Core Files

### `hooks/form/form-context.tsx`

Creates the React context that connects `useAppForm` to field/form components:

```tsx
import { createFormHookContexts } from '@tanstack/react-form';

export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();
```

### `hooks/form/form.tsx`

Wraps `createFormHook` with registered field and form components:

```tsx
import { Button, type ButtonProps } from '@hushletter/ui/components';
import { createFormHook, useStore } from '@tanstack/react-form';

import { FormForm } from '@/components/form/form-form';

import { fieldContext, formContext, useFormContext } from './form-context';

export const { useAppForm, withForm, withFieldGroup } = createFormHook({
  fieldComponents: {
    // Register field components here, e.g.:
    // Input: FormInput,
  },
  formComponents: {
    Form: FormForm,
    SubscribeButton,
  },
  fieldContext,
  formContext,
});

export type AppForm = ReturnType<typeof useAppForm>;
```

`SubscribeButton` is a submit button that automatically handles:

- Disabled state while submitting
- Loading indicator via `isPending`
- Optional `isDefaultValueDisabled` to prevent submitting unchanged forms
- Microtask-deferred submission so state updates flush before `handleSubmit()`

### `components/form/form-input.tsx`

Field component wired to TanStack Form field context:

```tsx
// Uses useFieldContext<string>() to access field state
// Renders Label + Input + error messages from field.state.meta.errors
```

### `components/form/form-form.tsx`

Wraps `@hushletter/ui` `Form` (from `@base-ui/react/form`) and prevents default submission, routing it through `form.handleSubmit()`.

## Validation

Use Zod schemas with TanStack Form's `validators` option.

### Validation modes

| Mode                                | Behavior                                   |
| ----------------------------------- | ------------------------------------------ |
| `validators: { onChange: schema }`  | Validates on every keystroke               |
| `validators: { onSubmit: schema }`  | Validates only on submit                   |
| `validators: { onSubmitAsync: fn }` | Async validation on submit (server checks) |

### `revalidateLogic` — dynamic revalidation

Use `revalidateLogic` to control when validation fires before and after the first submission. This avoids showing errors too early while giving instant feedback once the user has attempted to submit.

```tsx
import { revalidateLogic } from '@tanstack/react-form';

const form = useAppForm({
  // ...
  validationLogic: revalidateLogic({
    mode: 'submit', // before first submit: only validate on submit
    modeAfterSubmission: 'change', // after first submit: validate on every change
  }),
  validators: {
    onSubmit: schema,
  },
});
```

| Option                | Values                           | Default    | Description                              |
| --------------------- | -------------------------------- | ---------- | ---------------------------------------- |
| `mode`                | `"change"`, `"blur"`, `"submit"` | `"submit"` | When to validate before first submission |
| `modeAfterSubmission` | `"change"`, `"blur"`, `"submit"` | `"change"` | When to validate after first submission  |

The recommended default for most forms is `mode: "submit"` + `modeAfterSubmission: "change"` — this keeps the form quiet until the user tries to submit, then gives real-time feedback as they fix errors.

### Schema examples from the codebase

```tsx
// Login — validate on change
const loginSchema = z.object({
  email: z.email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

// Signup — validate on change
const signupSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

// Settings — validate on change + async on submit
const profileNameSchema = z.object({
  name: z.string().max(100, 'Name must be 100 characters or less'),
});
```

### Where to put schemas

For simple forms, inline schemas are fine. For shared or complex schemas, extract them to `@/lib/validators/validator.<name>.ts`.

## Full Example

A typical form using `useAppForm` with Zod validation and a mutation:

```tsx
import { revalidateLogic } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';

import { useAppForm } from '@/hooks/form/form';

const schema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export function LoginForm() {
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: async (value: { email: string; password: string }) => {
      const result = await signIn.email({
        email: value.email,
        password: value.password,
      });

      if (result.error) {
        throw new Error(result.error.message);
      }

      return result;
    },
    onError: (error) => {
      toast.error(error.message || 'An error occurred');
    },
    onSuccess: () => {
      navigate({ to: '/newsletters' });
    },
  });

  const form = useAppForm({
    defaultValues: {
      email: '',
      password: '',
    },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync(value);
    },
    validationLogic: revalidateLogic({
      mode: 'submit',
      modeAfterSubmission: 'change',
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
            <field.Input label="Email" placeholder="e.g. johndoe@email.com" />
          )}
        </form.AppField>

        <form.AppField name="password">
          {(field) => (
            <field.Input
              label="Password"
              type="password"
              placeholder="**********"
              isRevealable
            />
          )}
        </form.AppField>

        <form.SubscribeButton type="submit">Sign in</form.SubscribeButton>
      </form.Form>
    </form.AppForm>
  );
}
```

## Advanced Patterns

### Server-side error handling

Use `setFieldMeta` to display server errors on specific fields by setting
`errorMap.onSubmit` (TanStack derives `meta.errors` from `errorMap`):

```tsx
onSubmit: async ({ value }) => {
  try {
    await createFolder({ name: value.name });
    form.reset();
  } catch (error) {
    if (error instanceof Error && error.message.includes("DUPLICATE")) {
      form.setFieldMeta("name", (prev) => ({
        ...prev,
        errorMap: {
          ...prev.errorMap,
          onSubmit: "A folder with this name already exists",
        },
      }));
      return;
    }
    throw error;
  }
},
```

### Async validation on submit

Combine `onChange` for client-side checks with `onSubmitAsync` for server checks:

```tsx
const form = useForm({
  defaultValues: { name: currentName ?? '' },
  validators: {
    onChange: profileNameSchema,
    onSubmitAsync: async ({ value }) => {
      // Server-side validation
      return undefined; // return error string or undefined
    },
  },
  onSubmit: async ({ value }) => {
    await updateProfile({ name: value.name || undefined });
    queryClient.invalidateQueries();
  },
});
```

### Render props (manual field rendering)

When you need full control over field markup instead of using registered components:

```tsx
<form.Field name="email">
  {(field) => (
    <div className="space-y-2">
      <label htmlFor={field.name}>Email</label>
      <Input
        id={field.name}
        value={field.state.value}
        onChange={(e) => field.handleChange(e.target.value)}
        onBlur={field.handleBlur}
      />
      {field.state.meta.errors.map((error, i) => (
        <p key={i} className="text-destructive text-sm">
          {String(error)}
        </p>
      ))}
    </div>
  )}
</form.Field>
```

### Mutations

Always wrap async operations (API calls, server actions) in a `useMutation` from TanStack Query. This gives you error/success callbacks, loading state, and retry logic — **do not** put async logic directly in `onSubmit`.

```tsx
const mutation = useMutation({
  mutationFn: async (value: { name: string }) => {
    return await createFolder({ name: value.name });
  },
  onError: (error) => {
    toast.error(error.message || 'An error occurred');
  },
  onSuccess: () => {
    form.reset();
  },
});

const form = useAppForm({
  // ...
  onSubmit: async ({ value }) => {
    await mutation.mutateAsync(value);
  },
});
```

> **Note:** Convex queries are reactive and update automatically — no need to manually invalidate queries after a mutation.

## Conventions

- Use `form.AppField` + registered field components for standard fields.
- Fall back to `form.Field` + render props only when custom markup is needed.
- Use `form.SubscribeButton` for submit buttons (handles loading/disabled states).
- Keep forms inside `<form.AppForm>` > `<form.Form>` wrapper.
- For async operations (API calls, server actions), always wrap in `useMutation` from TanStack Query — never put async logic directly in `onSubmit`. The form's `onSubmit` should only call `mutation.mutateAsync(value)`.
- Prefer `onChange` validation for instant feedback; use `onSubmit` for expensive checks.
