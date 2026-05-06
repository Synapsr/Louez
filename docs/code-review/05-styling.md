# Code Review — Styling

> Applies when: Tailwind classes or style-related files are changed.

## Rules

### [SY-01] Tailwind only, no custom CSS

Use Tailwind utility classes for all styling. Custom CSS is acceptable only for:
- Global resets / base styles
- Animations that can't be expressed with Tailwind
- Third-party component overrides

### [SY-02] No inline style objects

Don't use React `style={{ }}` props. Use Tailwind classes instead. Exception: truly dynamic values computed at runtime (e.g., `style={{ width: `${percentage}%` }}`).

### [SY-03] Responsive design is mobile-first

Start with mobile styles, add breakpoint modifiers for larger screens:

```tsx
// Good — mobile first
<div className="flex flex-col md:flex-row lg:gap-8">
```

### [SY-04] Use design tokens via Tailwind config

Colors, spacing, and typography values come from the Tailwind config / CSS variables. Don't hardcode hex colors or pixel values in class names.

```tsx
// Bad
<div className="text-[#1a73e8]">

// Good
<div className="text-primary">
```

### [SY-05] Conditional classes use `cn()` or `clsx()`

For conditional class application, use a utility function. Don't do string concatenation.

```typescript
// Bad
<div className={`btn ${isActive ? "btn-active" : ""}`}>

// Good
<div className={cn("btn", isActive && "btn-active")}>
```

### [SY-06] Dark mode support

Use Tailwind's `dark:` modifier. Every color that changes between themes must have a dark variant defined.

---

## Related

- [from-scratch/05-frontend.md](../from-scratch/05-frontend.md) — Component architecture (where Tailwind lives)
- [from-scratch/03-packages.md](../from-scratch/03-packages.md) — `@louez/ui` primitives and icon registry
- [03-react-patterns.md](03-react-patterns.md) — Using Tailwind inside components (`cn()`, dynamic classes)
