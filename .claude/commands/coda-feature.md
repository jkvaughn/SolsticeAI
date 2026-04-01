---
name: coda-feature
description: Scaffold a new CODA feature — migration, endpoints, hooks, components, route, nav
triggers:
  - new feature
  - scaffold feature
  - start task
---

# CODA Feature Scaffold

Quickly bootstrap a new feature with all the boilerplate.

## Usage
When starting a new task (e.g. "Task 151 — Role-Based Auth"), this skill creates the skeleton files so you can focus on logic.

## Steps

### 1. Database migration (if needed)
Create migration file:
```
supabase/migrations/YYYYMMDDHHMMSS_<feature_name>.sql
```
Follow existing patterns:
- `CREATE TABLE IF NOT EXISTS`
- `gen_random_uuid()` for PKs
- Indexes on lookup columns
- `update_updated_at_column()` triggers where appropriate

### 2. Backend endpoints (if needed)
Add to `supabase/functions/server/index.tsx`:
- Use literal route strings: `app.get("/make-server-49d15288/<route>", ...)`
- **GET** for reads, **POST** for mutations (callServer limitation)
- Gate with `requireUser(c)` or `requireAdmin(c)` as appropriate
- Add `logAuditEvent()` calls for mutations
- Add new headers to CORS `allowHeaders` if needed

### 3. Frontend hook
Create `src/app/hooks/use<Feature>.ts`:
- Use `useSWRCache` for data fetching (key, fetcher, ttl)
- Use `userCallServer` for GET, `userCallServerPost` for mutations
- Export data, loading state, mutation functions
- Add local dev fallback if appropriate (`isLocalDev` pattern from useUserProfile)

### 4. Frontend components
Create under `src/app/components/<feature>/`:
- Follow XD reference patterns:
  - Section headers: `text-[15px] font-normal text-black/70`
  - Field labels: `text-[12px] font-normal text-black/40`
  - Inputs: fill-only `bg-black/[0.03] rounded-lg border-none`
  - Cards: `ring-1 ring-black/[0.04]` with hover `ring-black/[0.08]`
- Use `animate-fadeIn` for loaded content
- Use skeleton loaders (pulse animated) while loading
- Use `WidgetShell` for standalone widgets, plain divs inside Settings tabs

### 5. Route (if new page)
Add to `src/app/routes.tsx`:
```tsx
{ path: '<route>', Component: <PageComponent> },
```

### 6. Sidebar nav (if new page)
Add to `src/app/components/dashboard/dashboard-layout.tsx`:
- Import Lottie animation from `../icons/lottie`
- Add to appropriate nav array (opsNav, adminNav, configNav)
- Update persona dimming in `PERSONA_PRIMARY_ITEMS` if needed

### 7. PageShell integration (if new page)
Wrap in `<PageShell>` with:
- `title`, `subtitle`
- `stats` array (PageStat[])
- `tabs` array if tabbed (PageTab[])
- `activeTab` + `onTabChange` for tab state

## Checklist
- [ ] Migration file created (if needed)
- [ ] Backend endpoints added with correct route prefix
- [ ] Frontend hook with SWR caching
- [ ] Components follow XD design patterns
- [ ] Route added
- [ ] Nav item added (if new page)
- [ ] Build passes: `npx vite build`
- [ ] Local dev works with mock/fallback data
