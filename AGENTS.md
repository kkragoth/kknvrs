Use the `@/` import alias for all cross-file imports (it maps to `src/` via tsconfig `paths` + `tsc-alias` on build); never use relative `./` or `../` imports.
Model state as ADTs: use `enum` + discriminated unions with exhaustive `switch` and predicate/transition helpers in `src/lib/`; never compare raw string literals (e.g. `turn.phase === 'done'`) at call sites.
Do not prop-drill shared state through components; lift shared UI state into React context (e.g. theme) or a zustand store and pass data down, not setters.
Prefer `cond && <Component />` over `cond ? (...) : null` for conditional rendering; reserve ternaries for true either/or branches.
Keep components small and single-purpose; extract screen sections into `src/components/` instead of growing `App.tsx` — views read zustand stores and lib helpers, never setters through props.
Indent with 4 spaces (tab width 4, enforced via `prettier --check` + `.editorconfig`); keep `tsc`, `oxlint`, and `tsc-alias` clean.
