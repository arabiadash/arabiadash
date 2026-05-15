\# ADR-001: Multi-Workspace Architecture



\*\*Status\*\*: Accepted  

\*\*Date\*\*: 2026-05-15  

\*\*Commits\*\*: 0c33aff (Phase 4.4a)



\## Context



ArabiaDash تجمع ad accounts من Meta, Google, TikTok, Snapchat, Salla, Zid. 

هل نخلّي الـ user يربط كل الـ accounts في dashboard واحد موحّد، أم نقسّمهم؟



السوق المستهدف فيه نوعين من users:

\- \*\*Brand owners\*\*: شركة واحدة، عدة ad accounts على منصات مختلفة

\- \*\*Agencies\*\*: عدة عملاء، كل عميل له ad accounts مستقلة



\## Decision



Multi-workspace architecture. كل user يقدر ينشئ workspaces متعدّدة. كل workspace 

يحتوي ad accounts من منصات مختلفة. الـ blending يحدث فقط داخل الـ workspace.



كل user عنده default workspace تلقائي عند الـ signup.



\## Alternatives Considered



\### 1. Flat selector (account-level filtering)

\- ✗ ad accounts من شركات مختلفة ما يصح خلطهم في تقرير واحد

\- ✗ يخلط بيانات agency clients مع بعض

\- ✗ لا يدعم use case الـ agencies



\### 2. Multi-tenant (workspace = account)

\- ✗ يفترض كل user عنده business واحد فقط

\- ✗ يحتاج user حسابات متعدّدة للـ agencies (UX سيء)



\## Rationale



مأخوذ من:

\- \*\*Triple Whale\*\*: Multi Shop View

\- \*\*Northbeam\*\*: 1:1 dashboard-to-domain



كلا الـ tools يفصل الـ data بطبيعة الـ business، مش حسب technical convenience.



\## Consequences



\### Positive

\- ✅ يخدم brand owners + agencies بنفس الـ architecture

\- ✅ لا blending غير منطقي

\- ✅ unified pattern لكل المنصات الجاية (TikTok, Snap, Salla, Zid)



\### Negative

\- ❌ كل query في dashboard/reports يحتاج workspace filter

\- ❌ workspace switcher UI يضيف complexity

\- ❌ link preservation بين الصفحات (workspace context)



\### Implementation

\- Database: workspaces table + connections.workspace\_id NOT NULL

\- State: URL param `workspace` (see ADR-002)

\- UI: switcher في DashboardSidebar

