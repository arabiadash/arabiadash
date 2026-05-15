\# ADR-002: Workspace State via URL Params



\*\*Status\*\*: Accepted  

\*\*Date\*\*: 2026-05-15  

\*\*Related\*\*: ADR-001 (Multi-Workspace Architecture)



\## Context



بعد قرار Multi-Workspace (ADR-001)، نحتاج طريقة لتتبع الـ active workspace 

في كل صفحة. الـ user يبدّل بين workspaces عبر switcher في الـ sidebar.



ثلاث خيارات متاحة:

1\. React Context

2\. localStorage  

3\. URL params



\## Decision



URL params باسم `workspace`. الـ default workspace يستخدم URL نظيف بدون param.

non-default workspaces تستخدم `?workspace=<id>`.



\## Alternatives Considered



\### 1. React Context

\- ✗ يحتاج تحويل كل page.tsx إلى Client Component

\- ✗ يكسر الـ Server Components pattern الحالي

\- ✗ لا يدعم shareable links



\### 2. localStorage

\- ✗ يكسر SSR — Server يرندر بـ default، Client يقفز للـ stored value (hydration mismatch)

\- ✗ لا يدعم shareable links

\- ✗ Server Components ما تقدر تقرأه



\### 3. URL params ✓

\- ✅ Shareable: agency يرسل link `?workspace=2` للعميل

\- ✅ Server Components تقرأ من `searchParams` (Promise في Next.js 16)

\- ✅ Browser back/forward يشتغل تلقائياً

\- ✅ لا hydration issues



\## Rationale



الـ Server Components pattern الحالي حاسم للأداء. URL params هي الطريقة الوحيدة 

اللي تدعمه + تدعم shareable links اللي محتاجها agencies.



الـ default workspace URL نظيف (`/dashboard` بدل `/dashboard?workspace=1`) لأن 

90% من الـ users brand owners بـ workspace واحد — ما يحتاجون يشوفون noise.



\## Consequences



\### Positive

\- ✅ Server Components تشتغل بدون refactor

\- ✅ Shareable URLs لكل workspace

\- ✅ لا state synchronization issues



\### Negative

\- ❌ Sidebar links تحتاج logic للحفاظ على الـ workspace param بين الصفحات

\- ❌ Invalid `?workspace=<id>` يحتاج silent fallback للـ default



\### Implementation

\- Switcher يستخدم `router.push(pathname + ?workspace=X)`

\- DashboardSidebar nav links يستخدمون `useSearchParams()` للحفاظ على الـ param

\- `resolveActiveWorkspace()` helper في `src/lib/workspaces.ts` يتعامل مع الـ validation

