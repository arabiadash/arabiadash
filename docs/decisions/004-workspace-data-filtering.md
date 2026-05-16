\# ADR-004: Workspace Data Filtering + OAuth Propagation



\*\*Status\*\*: Accepted  

\*\*Date\*\*: 2026-05-16  

\*\*Related\*\*: ADR-001 (Multi-Workspace Architecture), ADR-002 (Workspace State via URL Params), ADR-003 (Workspace CRUD Design)



\## Context



Phase 4.4 shipped workspaces (foundation + switcher + CRUD). Phase 4.2 needs 

to filter dashboard data per active workspace — when a user switches workspace 

في الـ switcher، الـ dashboard لازم يعرض فقط الـ connections + data 

الخاصة بـ ذلك الـ workspace، مش كل الـ user data.



عدّة قرارات معمارية ظهرت من الـ implementation وتستحق التوثيق حتى لا نعيد 

المناقشة بعد 6 أشهر.



\## Decisions



\### 1. Hybrid filtering approach (DB layer، مش API layer)



الـ connections layer (server-side في page.tsx) يفلتر بـ `workspace_id`. الـ 

APIs (`/api/ads/insights`, `/api/ads/account`, إلخ) تظل workspace-agnostic 

ولكن تقبل `account_id` optional لـ scoping دقيق.



\#### Why



\- APIs بسيطة (single responsibility — جلب data بـ provider + account)

\- Caching keys ما يتغيّروا — `account_id` يكفي للـ partition

\- Workspace logic مركّز في `src/lib/workspaces.ts` + `page.tsx`

\- لا duplication للـ ownership/RLS checks في كل endpoint



\#### Alternative considered: API-level workspace enforcement



\- ✗ يحتاج تعديل كل endpoint ليأخذ `workspace_id`

\- ✗ يكرّر RLS checks (الـ DB يحمي بالفعل بـ user_id)

\- ✗ Caching keys تـ become workspace-scoped → cache miss rate أعلى



\### 2. Cookie-based workspace propagation through OAuth



Meta و Google OAuth flows يـ propagate الـ active workspace عبر cookies 

منفصلة:

\- `meta_oauth_workspace` (alongside `meta_oauth_state` CSRF cookie)

\- `google_ads_oauth_workspace` (alongside `google_ads_oauth_state`)



الـ init route يقرأ `?workspace=<id>` من الـ URL ويخزّنه في الـ cookie. الـ 

callback يقرأه + يـ validate (ownership + non-archived) + يـ fallback لـ 

`getDefaultWorkspaceId` لو invalid. الـ cookie يـ delete بعد الـ read 

(stateless flows).



\#### Why



\- Minimal change — cookie واحد إضافي لكل provider

\- Validation layer مع defensive fallback يحمي من cookie tampering

\- يماشي نمط الـ CSRF state cookie الموجود



\#### Trade-off: Multi-tab OAuth race



لو user يفتح 2 tabs ويبدأ OAuth في كل واحد، آخر write للـ cookie يفوز — قد 

يـ end up في workspace غير المتوقّع. \*\*مقبول\*\* لأن نفس الـ race موجود 

للـ CSRF state cookie الموجودة من قبل — مش regression. لو الـ scenario 

ظهر فعلاً في production → refactor لـ state JSON pattern (مرّر workspace 

ضمن OAuth state).



\### 3. SWR cache scoping via URL params



استخدم الـ default URL-based cache key من SWR. الـ `account_id` في الـ URL 

يعمل cache-scope: workspace switch يغيّر الـ `account_id` → URL مختلفة → 

fresh fetch. لا حاجة لـ manual cache key.



\#### Why



\- Simpler من الـ original spec proposal (`insights:${workspace_id}:...`)

\- يستفيد من SWR's built-in URL-keying

\- Cache invalidation تلقائي بدون extra logic



\### 4. Meta single-account limitation



`src/lib/ads/factory.ts` يـ define `MULTI_ACCOUNT_PROVIDERS = Set(["google"])` — 

Meta عمداً مستثناة. الـ `maybeSingle()` في `factory.ts` يـ throw على 2+ Meta 

rows لـ نفس الـ user.



DashboardClient يستخدم `connections.find((c) => c.platform === "meta")` لـ 

picking أول Meta connection في الـ workspace.



\#### State اليوم



\- DB-verified: zero users بـ multi-active-Meta حالياً

\- Server-side warn log في `page.tsx` لو الـ scenario ظهر:

  `[dashboard] user=X workspace=Y metaActiveCount=N — using first only`



\#### Future



لو multi-tenant Meta usage emerges، نحتاج dedicated phase لـ multi-account 

Meta aggregation:

\- Multiple `useInsights` calls (one per account)

\- Client-side aggregation logic

\- API support لـ aggregated queries (أو client iterates)



\### 5. Two cross-workspace leaks discovered + fixed in Phase 4.2



Discovered during manual testing بعد ما الـ filtering وصل لـ DashboardClient.



\#### Leak A — `/api/ads/insights` (fixed in commit 4.5)



\- `useInsights({provider: "meta", accountId: undefined})` كان يـ call الـ API بدون `account_id`

\- API's `maybeSingle()` كان يرجع Meta data من workspace آخر

\- \*\*Fix\*\*: `skip` flag في `useInsights`. لو `accountId` undefined و provider Meta، الـ hook يـ bypass الـ fetch ويرجع synthetic `noConnection: true` state



\#### Leak B — `/api/ads/account` (fixed in commit 4.6)



\- Inline `useEffect` في `DashboardClient.tsx` كان يـ call `/api/ads/account?provider=meta` بدون `account_id`

\- الـ endpoint ما كان يقبل `account_id` أصلاً — يـ fall back على `maybeSingle()`

\- \*\*Fix (defense in depth)\*\*:

  1. API: `/api/ads/account` الآن يقبل optional `?account_id=` (backward compatible)

  2. Client: الـ useEffect يـ skip لو `metaAccountId` undefined + يمرّر `account_id` لما present



الـ 2 fixes يشتغلون معاً: client-side skip يتجنّب round-trips غير ضرورية، 

API-level filter يحمي حتى لو client يـ misuse الـ endpoint.



\### 6. Phase 4.3 deferred leak surface (KNOWN, documented)



نفس الـ leak pattern موجود في 3 sites إضافية، كلهم في ReportsClient — مش Phase 4.2 scope:



\- `/api/ads/campaigns?provider=meta` (ReportsClient.tsx:1185, inline fetch)

\- `/api/ads/creatives?provider=meta` (via `useAds` hook, ReportsClient.tsx:1134)

\- `/api/ads/account?provider=meta` (ReportsClient.tsx:1174 — separate call site من Dashboard)



كلها vulnerable لنفس الـ leak. سـ يتم معالجتها في Phase 4.3 (Reports refactor 

per-workspace) باتباع نفس الـ pattern:

\- API يقبل optional `account_id`

\- Client passes it + skips when undefined



\### 7. Future ADR-005 candidate: server-side workspace enforcement



اليوم: APIs تقبل `account_id` كـ optional filter. الـ defense rely على 

clients يـ pass الصحيح.



Future: تـ require `workspace_id` (أو `account_id`) لـ Meta endpoints. هذا 

يـ close الـ leak surface على API layer، مش per-client.



Deferred until Phase 4.3 يخلص — أحسن فهم للـ scope لما كل الـ Meta call sites 

تـ refactor بـ نفس الـ pattern.



\## Consequences



\### Positive



\- ✅ Phase 4.2 ships safely بدون cross-workspace data leaks (Dashboard)

\- ✅ Pattern symmetric عبر endpoints (account_id support)

\- ✅ Backward compatible (account_id optional في كل endpoints)

\- ✅ Clear path لـ Phase 4.3 (same pattern للـ campaigns + creatives) + future ADR-005

\- ✅ Hybrid filtering يبقي الـ APIs بسيطة وقابلة للتطوير

\- ✅ Soft-delete من Phase 4.4c يضمن إن الـ archived workspaces ما تـ leak data



\### Negative



\- ❌ Multiple client-side guards مطلوبة لكل Meta endpoint (whack-a-mole pattern)

\- ❌ Hook جديد بدون skip = potential bug جديد

\- ❌ Coupling implicit بين useInsights skip + accountCurrency stale logic

\- ❌ Multi-tab OAuth race ما يـ fix — accepted كـ pre-existing issue



\### Mitigations



\- ADR-004 يوثّق كل الـ known leak sites + الـ fix pattern

\- Code comments في `DashboardClient.tsx:158-168` يوثّق الـ coupling

\- GitHub tech-debt issue للـ Phase 4.3 refactor + future ADR-005

\- Server-side warn log في page.tsx للـ multi-Meta scenario

\- Manual test scenarios في الـ PR description تحدّد الـ verification path



\## Implementation



\- `src/lib/workspaces.ts`: `getActiveConnectionsForWorkspace` helper + `WorkspaceConnection` type

\- `src/app/dashboard/page.tsx`: 2-wave fetching (workspace resolution → connections)

\- `src/app/dashboard/DashboardClient.tsx`: receives filtered connections, derives `connectedPlatforms` + `metaAccountId`, skips Meta hooks when no Meta in workspace

\- `src/lib/hooks/use-insights.ts`: `skip` option for cross-workspace leak guard

\- `src/components/dashboard-empty-state.tsx`: reusable empty state component

\- `src/app/api/auth/meta/{init,callback}/route.ts`: cookie-based workspace propagation

\- `src/app/api/google-ads/{auth,callback}/route.ts`: same pattern

\- `src/app/api/ads/account/route.ts`: optional account_id filter

\- `src/app/dashboard/connections/*ConnectionsClient.tsx`: pass `activeWorkspaceId` in OAuth init URLs + TikTok/Snap placeholder
