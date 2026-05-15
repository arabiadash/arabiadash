\# ADR-003: Workspace CRUD Design



\*\*Status\*\*: Accepted  

\*\*Date\*\*: 2026-05-16  

\*\*Related\*\*: ADR-001 (Multi-Workspace Architecture), ADR-002 (Workspace State via URL Params)



\## Context



Phase 4.4c — workspace CRUD UI. بعد ADR-001 (workspace abstraction) و ADR-002 

(URL params)، الـ users يحتاجون يديرون workspaces: ينشئون، يعدّلون الاسم، 

يعيّنون الـ default، ويحذفون. كل عملية لها 2-3 خيارات تصميمية بـ consequences 

مختلفة على الـ phases القادمة (4.6 currency, 6 events table, 10 plans).



هذا الـ ADR يوثّق الـ 5 قرارات الرئيسية حتى لا نعيد المناقشة بعد 6 أشهر.



\## Decisions



\### 1. Soft Delete (Archive) بدل Hard Delete



workspaces table فيها `archived_at TIMESTAMPTZ NULL`. عملية الحذف = 

`UPDATE archived_at = NOW()`. كل الـ list queries تفلتر `WHERE archived_at IS NULL`.

الـ indexes تم تحديثها لتتجاهل archived rows (`workspaces_one_default_per_user`، 

`workspaces_user_name_unique`، الـ partial index الجديد `idx_workspaces_user_active`).



\#### Why



\- Future-proof: restore feature، activity log، audit trails — كلها تحتاج الـ row يبقى موجود

\- Data retention compliance: لو user حذف workspace فيه connections قديمة، الـ data ما يضيع تماماً

\- Easier rollback: لو user أرشف بالخطأ، نقدر نعكس بـ `UPDATE archived_at = NULL`



\#### Alternative considered: Hard DELETE



\- ✗ Destructive: الـ user يفقد كل reference للـ workspace + الـ connections القديمة

\- ✗ Foreign key cascade questions: لو هذا الـ workspace فيه historic connections بـ insights مخزّنة، شو نسوي؟

\- ✗ Restore impossible: لو user غيّر رأيه بعد أسبوع، ما في recovery path



\### 2. Plan Limit Central في plans.ts



`WORKSPACE_LIMIT = Infinity` في `src/lib/plans.ts` مع `TODO(phase-10)` comment. 

الـ `createWorkspace` action يقرأ من هنا للـ enforcement.



\#### Why



\- Single source of truth: لما نضيف subscription tiers في Phase 10، نغيّر سطر واحد في plans.ts بدل ما نبحث عن enforcement code في الـ actions

\- Mirrors existing pattern: `ACTIVE_ACCOUNTS_LIMIT` يتبع نفس الـ structure من قبل

\- Plan-aware function signature stable: Phase 10 يبدّل `WORKSPACE_LIMIT` بـ `getWorkspaceLimitForUser(userId)` — الـ call sites ما تتغيّر



\#### Alternative considered: Hardcode in createWorkspace



\- ✗ Couples the action to a constant — scattering plan logic

\- ✗ Phase 10 يحتاج multi-file refactor بدل single-file swap



\### 3. Dedicated Edit Page بدل Inline Rename



`/dashboard/settings/workspaces/[id]/edit` كـ route مستقل. اليوم يحتوي field واحد فقط (الاسم). 

Phase 4.6 سيضيف `currency` field، Phase 10 سيضيف `icon` بدون refactor للـ structure.



\#### Why



\- Extensible: settings forms تكبر بسرعة — currency, icon, default workspace flag، إلخ. الـ dedicated page يعطي مساحة بدون كسر الـ list UX

\- Isolation: الـ form state معزولة عن الـ settings page state — لا conflicts مع password tab الخ

\- Linkable: shareable URL لـ direct navigation



\#### Alternative considered: Inline rename in settings list



\- ✗ Limits future fields: لو أضفنا currency لاحقاً، الـ list item يكبر ويصير cluttered

\- ✗ Mixes concerns: الـ list يصير edit form + list في نفس الوقت

\- ✗ Form state conflicts: لو user يعدّل workspace 1 وفي نفس الوقت يضغط "set default" على workspace 2، الـ state يصير معقّد



\### 4. Two-step setDefault + Best-effort Rollback



`setWorkspaceAsDefault` يعمل step واحد UPDATE لإزالة الـ default الموجود، ثم step ثاني 

لـ تعيين الـ target. لو الـ second step فشل، نحاول rollback بإعادة الـ default القديم.

\*\*ليس\*\* Postgres RPC.



\#### Why



\- Partial unique index `workspaces_one_default_per_user` يمنع state "2 defaults" نهائياً على مستوى الـ DB

\- Worst case = 0 defaults transient (لو step 2 فشل + rollback فشل) — لكن `resolveActiveWorkspace` يرجع `all[0]` كـ fallback، الـ UI ما ينكسر

\- DB invariants تحمي الـ ground truth — الـ application logic يحاول best-effort للـ UX



\#### Trigger to upgrade



لو الـ monitoring يكشف عن zero-default cases فعلياً في production → نرقّي لـ Postgres RPC لـ true atomicity.



\#### Alternative considered: Postgres RPC



\- ✓ Truly atomic transactional update

\- ✗ يحتاج migration ثاني (function definition + GRANT EXECUTE)

\- ✗ Premature: الـ failure mode rare جداً في الممارسة، الـ DB constraint يكفي حالياً



\### 5. Event Logging بـ console.log Structured Format



كل CRUD action يـ log بنفس الـ format:



\- `[workspace.created] user=X workspace=Y name="Z"`

\- `[workspace.renamed] user=X workspace=Y from="A" to="B"`

\- `[workspace.archived] user=X workspace=Y`

\- `[workspace.set_default] user=X workspace=Y`



\#### Why



\- Prepared للـ retrofit: Phase 6 سـ يبني events table — الـ structured format يـ parse trivially لـ rows في الـ DB

\- Vercel logs محفوظة لمدة 7 أيام — كافية للـ debugging الفوري

\- Zero infrastructure now: لا migration، لا new table، لا code complexity



\#### Alternative considered: events table now



\- ✗ Premature: schema الـ events table يجب يدعم 6+ feature areas (workspace, connection, alert, إلخ)، نحتاج معرفة كل الـ events قبل ما نـ design

\- ✗ Risk of refactoring twice: لو decided الـ schema غلط، الـ migration للـ existing rows مؤلم

\- ✗ Phase 6 سـ يبني هذا بطريقة صحيحة مع معرفة كل الـ event types



\## Consequences



\### Positive



\- ✅ Phase 4.6 (currency, icon fields) يبني فوق الـ edit page بدون refactor

\- ✅ Phase 6 (events table) يبني فوق الـ logging format بـ retrofit بسيط

\- ✅ Phase 10 (subscription tiers) يبدّل سطر واحد في plans.ts لتفعيل الـ limit

\- ✅ Restore feature ممكنة في أي وقت بدون migration — الـ data موجود

\- ✅ DB invariants تحمي الـ ground truth — الـ application bugs لا تكسر الـ state



\### Negative



\- ❌ `archived_at` column يزيد الـ storage قليلاً (8 bytes/row — negligible)

\- ❌ Two-step setDefault أقل safe theoretically من RPC (مقبول عملياً)

\- ❌ Event logs محتاجة manual retrofit في Phase 6 (متوقّع، planned)



\### Mitigations



\- ADR documentation للـ context المستقبلي

\- Manual testing يغطي الـ 6 acceptance scenarios قبل الـ merge

\- Server-side rules enforced (not client-only) — الـ business logic testable

\- Structured log format → trivial retrofit للـ events table

\- WORKSPACE_LIMIT central → Phase 10 swap بسطر واحد



\## Implementation



\- `src/lib/workspaces.ts`: `getUserWorkspaces` filters archived, `getActiveConnectionsCount` للـ archive validation

\- `src/app/dashboard/settings/workspaces/actions.ts`: 4 server actions

\- `src/components/new-workspace-modal.tsx`: creation via `useActionState`

\- `src/components/archive-workspace-dialog.tsx`: confirmation via `useTransition` + key-based remount

\- `src/app/dashboard/settings/workspaces/[id]/edit/`: dedicated edit page (Server + Client)

\- `src/components/workspace-switcher.tsx`: actions section في الـ dropdown
