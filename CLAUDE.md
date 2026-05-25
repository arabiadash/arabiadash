# ArabiaDash — Project Context for Claude Code

This file is read automatically by Claude Code at the start of every session.
It encodes locked decisions and environmental constraints so they don't need
to be re-explained each time.

---

## 1. Stack (exact versions, do not assume from training)

| Layer | Tech | Notes |
|-------|------|-------|
| Framework | Next.js 16.2.4 | Turbopack, App Router (NOT Pages Router) |
| Runtime | React 19.2.4 | React Compiler enabled |
| Language | TypeScript 5 | Strict mode |
| Styling | Tailwind CSS 3.4.1 | DO NOT upgrade to v4 — incompatible |
| Auth/DB | Supabase | @supabase/ssr 0.10, PKCE flow |
| Charts | Recharts 3.8, Framer Motion 12, Lucide React | — |
| Deployment | Vercel | CLI linked locally |

**Critical version-specific notes:**
- Next.js 16 **removed** the `eslint` property from `NextConfig` type. ESLint is no longer part of `next build`. Do not add `eslint: { ignoreDuringBuilds: true }`.
- React 19's React Compiler is strict about `set-state-in-effect`. Many flagged effects are false positives (query param reads, hydration-safe code, data fetching). Audit before refactoring.
- Tailwind 3.4.1 is locked. Do not run `npm install tailwindcss@latest`.

---

## 2. Environment

| Setting | Value |
|---------|-------|
| OS | Windows 11 |
| Shell | **Command Prompt ONLY** — PowerShell causes execution policy errors |
| Project path | `C:\Users\LENOVO\Desktop\adlytics` |
| Node global packages | vercel, supabase, gh |
| Git for Windows | Installed, but bash-style hooks don't spawn — skip Husky for now |

**Commit message convention on Windows:**
Multi-line messages don't work in CMD with a single `-m`. Use multiple `-m` flags:
```cmd
git commit -m "title line" -m "body paragraph"
```

---

## 3. Mandatory pre-commit checks

Run **both** before any commit. No exceptions.

```cmd
npx tsc --noEmit
npm run build
```

If either fails, fix before committing. Local Turbopack build is more lenient
than Vercel's TypeScript check, so `tsc --noEmit` is the ground truth.

For config file changes (`next.config.ts`, `tsconfig.json`, `package.json`):
also test the build path that uses the change.

---

## 4. Verification workflow (no browser needed)

Both Vercel CLI and GitHub CLI are installed and authenticated.

```cmd
# Check recent deployments
vercel ls

# Inspect a specific deployment's build logs
vercel inspect <deployment-url> --logs

# Check repo status
gh repo view
gh pr list
gh pr create

# Check last commit on origin/main
git log origin/main --oneline -1
```

Use these instead of asking the user to open dashboards or take screenshots.

---

## 5. Architecture (locked decisions)

### Pages
- All dashboard pages use **Server Component (`page.tsx`) + Client Component** pattern.
- RTL is set globally in `src/app/layout.tsx` with `lang="ar" dir="rtl"`. No per-page RTL handling needed.
- `searchParams` in Next.js 16 is a `Promise` — `const params = await searchParams`.

### Sidebar
- Unified `<DashboardSidebar />` at `src/components/dashboard-sidebar.tsx` (since commit `3c6f898`).
- Props: `fullName`, `email`, `activeRoute` (prefix-matched), `sidebarOpen`, `onClose`.
- Mobile drawer state stays in parents via `sidebarOpen` + `onClose` props (Option 2 — props-based, not Context).

### Workspaces
- Every user has an auto-created default workspace (`is_default=true`).
- Active workspace tracked via URL param `workspace`:
  - Clean URL for default (no param)
  - `?workspace=<id>` for non-default
- Switching = `router.push` on same pathname, update query param only.
- One workspace can hold multiple ad accounts from different platforms (Meta, Google, etc).
- Ad accounts from different workspaces NEVER blend in dashboard/reports.

### Connections (Approach C)
- OAuth callbacks save only the refresh token to `platform_credentials` (token isolation).
- New accounts are inserted via `/api/{platform}/select-accounts` after user selection in the selector UI (`/dashboard/connections/{platform}/select`).
- Plan limit: **cross-platform total** (Meta + Google + future TikTok/Snap/Salla/Zid combined).
- Trial = 3 accounts, Growth = 10, Agency = unlimited (see `src/lib/plans.ts` `canAddMoreAccounts`).
- `getUserTier()` stubbed to `"trial"` until Phase 10 billing.
- Deactivate flow (PATCH `/api/ads/connections/[id]`) flips `active` → `pending`.

### API
- Unified endpoints `/api/ads/insights` and `/api/ads/creatives` accept `?provider=meta|google`.
- Adapter pattern: `src/lib/ads/providers/<platform>.ts`.
- Factory: `getAdapterForProvider(userId, provider, accountId?)` in `src/lib/ads/factory.ts`.
- SWR cache tables: `insights_cache`, `creatives_cache`.

---

## 6. Critical technical traps

### gRPC + Turbopack
`google-ads-api` and any package using `@grpc/grpc-js` native bindings MUST be in
`serverExternalPackages` in `next.config.ts`. Turbopack bundling silently breaks
gRPC auth metadata. Symptom: `undefined undefined: undefined` errors.

Currently externalized:
```
google-ads-api, google-ads-node, google-gax,
@grpc/grpc-js, @grpc/proto-loader, long
```

### SSR-safe state for browser storage
`localStorage` reads cannot use lazy-init `useState` in SSR'd Client Components —
causes hydration mismatch (React Error #418).

```typescript
// CORRECT pattern
const [x, setX] = useState(default_value);
useEffect(() => {
  if (typeof window === 'undefined') return;
  const saved = localStorage.getItem(key);
  if (saved) setX(saved);
}, []);
```

### Generated types
Single source of truth for Supabase types is `src/lib/supabase/database.types.ts`.
Regenerate after schema changes:
```cmd
npx supabase gen types typescript --project-id fkljjwfhmmletytvevbp --schema public > src\lib\supabase\database.types.ts
```
Requires `SUPABASE_ACCESS_TOKEN` env var.

### Force-dynamic for fresh data
Server components reading connection/workspace state from Supabase use:
```typescript
export const dynamic = 'force-dynamic';
```

---

## 7. Workflow rules for recommendations

### Before recommending architectural changes
- **Web-search** Next.js 16 / React 19 / Tailwind 4 docs first. Training data is
  outdated on these edge versions.
- Present options with sources. Let the user review before passing to Claude Code.
- Quick fixes (typos, renames, imports) skip this gate.

### Before applying changes
- If a recommendation conflicts with actual code patterns (e.g. SSR-safe state,
  externalized packages, RLS policies), **stop and ask**.
- For unrelated changes found in `git diff`, ask the user if they should be
  separate commits.

### Never do
- Force-push to `main`
- Rewrite history on shared branches
- Add new top-level dependencies without confirmation
- Modify schema (Supabase) without confirmation
- Disable RLS policies
- Bypass plan limits

### Branching workflow (from Phase 4.4b sub-phase B onward)

Feature code goes on dedicated branches, NOT direct push to main:

```cmd
git checkout -b phase-X.X-description    # at start
# ... commits, push to branch
gh pr create                              # optional but recommended
# After verification on Vercel preview:
git checkout main
git merge phase-X.X-description
git push origin main
```

Direct push to main is allowed only for:
- Documentation (`CLAUDE.md`, README)
- Tooling configuration (`.gitignore`, `package.json` scripts)
- Hotfixes when main is broken

Feature commits MUST use branches.

---

## 8. Key project resources

| Resource | URL/Path |
|----------|----------|
| Production | https://arabiadash.com |
| Vercel preview | https://arabiadash.vercel.app |
| GitHub | https://github.com/arabiadash/arabiadash |
| Supabase | https://fkljjwfhmmletytvevbp.supabase.co (Seoul region) |
| Local | `C:\Users\LENOVO\Desktop\adlytics` |

---

## 9. Communication preferences

- User is a **non-technical builder**.
- Respond in **Arabic** with technical terms in plain language.
- User has strong product intuition. Trust their architectural preferences when stated.
- User prefers to control session length. Do not ask about fatigue.
- User wants **unified patterns** to avoid double-work across platforms.
- User defers billing/subscription architecture; product features come first.

---

## 10. Current state (update after major milestones)

- **Latest commit on origin/main**: see `git log origin/main --oneline -1`
- **Completed**: Phase 1-3 (backend), 4.1 through 4.5, 4.7 M1 + M2 (Google), 4.8 M1 (per-platform tabs), account selection pivot (PR #21, #22), Phase 4.8 M2-M6 (metrics expansion, conditional Revenue/ROAS, Dashboard mirror, FX rates, M5 text ads, M6 asset extensions), **Phase 4.8 M-PMax (PR #31, merged May 26, 2026)**
- **Next**: Phase 4.8 M7 (Keywords for Search ads — `ad_group_criterion` query) OR pre-launch hardening sprint (Issues #1-4, #6) — user choice
- **Future**: Phase 5 (alerts), 6 (AI), 7 (TikTok), 8 (Snap), 9 (Salla/Zid), 10 (billing), 11 (public launch)

### M-PMax milestone shipped — May 26, 2026 (PR #31)

Architecture (final state after retail-variant removal):

- **PMAX_ASSET_GROUP only** — retail variants (`PMAX_PRODUCT_GROUP` + `PMAX_SHOPPING_PRODUCT`) removed in `bb6eea2` per ADR-013 supersession addendum. Products inside PMax don't belong in a Creatives surface; product-level analytics is a separate concern for a hypothetical future Shopping Performance feature.
- `PMaxAssetGroupCard` — compact card design, click opens `AdDetailModal` with 5 tabs (الصور / الفيديوهات / العناوين / الأوصاف / معلومات إضافية)
- Assets grouped inside modal by `fieldType` (MARKETING_IMAGE / SQUARE / PORTRAIT / TALL_PORTRAIT / LOGO + YouTube videos)
- `asset_group_asset.status` WHERE filter excludes REMOVED links (commit `a3836e7`)
- `getAds()` simplified from 7-way to 3-way `Promise.all` (asset_groups + assets + asset_group purchase merger)

Effective ad status (commit `e621e9b`):

- `UnifiedAd.status` now reflects effective serving status (min-restrictive rollup of `campaign.status` + `ad_group.status` + `ad_group_ad.status`)
- `mapAdGroupStatus` mirrors `mapCampaignStatus` (9th instance of the documented integer-drift pattern: 2/3/4 = ENABLED/PAUSED/REMOVED enum convention — see `feedback_resource_name_over_integer_enums.md`)
- Ads from PAUSED parent campaigns correctly show موقوف instead of false-positive نشط

### Cache schema version history (`src/lib/ads/cache.ts` → `CACHE_SCHEMA_VERSION`)

| Version | Trigger | Commit |
|---------|---------|--------|
| v1 | Initial (implicit) | — |
| v2 | M5 — UnifiedAd gained headlines/descriptions/currency/imageUrl/carouselImages | — |
| v3 | M6 ADR-012 — UnifiedAd gained `extensions` (sitelinks/callouts/snippets) | — |
| v4 | M-PMax — UnifiedAd restructured as discriminated union (`ad_type` discriminator + `type_data`) | `b002516` |
| v5 | `asset_group_asset.status` filter invalidation | `6adeb51` |
| v6 | Effective ad status semantics (min-restrictive rollup) | `e621e9b` |
| v7 | PMax retail variants removed | `bb6eea2` |

### Active test accounts

- **imaa perfumes** — Google SAR (re-OAuthed 2026-05-25 after `invalid_grant`), Meta (re-authed 2026-05-26)
- Production: arabiadash.com (`alkhateib94@gmail.com`)

### Lessons captured this milestone

- **OAuth redirect URIs in external consoles must be typed manually, never pasted** — invisible-char from paste-corruption was the root cause of Issue #33 Meta OAuth "URL Blocked" (resolved 2026-05-26). Visual matching via copy-compare is unreliable.
- **Cache bumps + silent OAuth failures interact destructively** — the v5→v6 bump in `9caac84` unmasked broken imaa OAuth that had been silently failing, surfaced as fake "0 campaigns regression." Root-cause diagnostic preserved in `docs/recon/pmax-recon-stage-5-2026-05-26.md`.
- **YAGNI applied successfully mid-milestone** — `PMAX_PRODUCT_GROUP` + `PMAX_SHOPPING_PRODUCT` variants were built, then removed before merge once the user realized they don't conceptually belong in Creatives. Saved future double-work per Memory #27.

### ADR list

- **ADR-005** — Google integration + multi-currency
- **ADR-008** — No silent defaults
- **ADR-011** — Two-query GAQL purchase filter (now seven sibling mergers across campaign/time-series/ad/asset_group levels; product_group + shopping_product mergers removed with the variants)
- **ADR-012** — Google asset extensions architecture
- **ADR-013** — PMax architecture. **Decisions 1-3 superseded by 2026-05-25 addendum** removing retail variants. `PMAX_ASSET_GROUP` (Decision 4+) remains canonical.

### Open issues (13 open — verified via `gh issue list --state open` on 2026-05-25 post-M-PMax merge)

**Bug + tech-debt (Phase 11 launch blocker — user-facing)**
| # | Title | Opened |
|---|-------|--------|
| #32 | Reports page blocked behind Meta-only check — Google-only users see empty state | 2026-05-24 |

**Tech-debt — pre-launch hardening batch (2026-05-18)**
| # | Title |
|---|-------|
| #24 | normalizeAd: mirror #15 purchase filter for per-ad creative surface — **likely already shipped** via M-PMax Commit 4b (`d1a8581`); needs verification + close |
| #25 | Migrate google-ads sync helpers from `connections.access_token` to `platform_credentials.refresh_token` (ADR-010 drift) |
| #26 | Q2 result caching at adapter layer |
| #27 | Rename `admin` parameter to `client` in `conversion-actions.ts` helpers |
| #28 | Cleanup test `auth.users` accounts before Phase 11 launch |
| #29 | `meta_insights_cache` legacy table cleanup (pre-SWR schema, unused) |
| #30 | Schema-wide GRANT review — anon role has TRUNCATE/TRIGGER/REFERENCES on multiple tables |

**Tech-debt — early Google integration (2026-05-15)**
| # | Title |
|---|-------|
| #1 | Re-sync 4 Google accounts dropped during migration |
| #2 | Add `user_enabled` BOOLEAN to connections table |
| #3 | Add `date_from <= date_to` validation on ads + campaigns routes |
| #4 | Verify Google access_token refresh behavior under load |
| #6 | Workspace actions list shows stale state after `setWorkspaceAsDefault` |

**Resolved during this milestone**
- **#33** Meta OAuth "URL Blocked" on production — resolved 2026-05-26 (invisible-char in Facebook Console's Valid OAuth Redirect URIs field; fix = retype URL manually)
- **Effective ad status fix** — shipped via commit `e621e9b`; no tracking issue exists (Q9 probe verified, imaa bug scenarios reproduced + fixed)