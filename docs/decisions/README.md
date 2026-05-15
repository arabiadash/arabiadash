\# Architecture Decision Records



ملفات توثّق القرارات المعمارية الكبيرة في المشروع.



\## متى ننشئ ADR جديد؟



\- قرار يأثر على أكثر من ملف/feature

\- اخترنا approach وأهملنا approach ثاني

\- لو سُئلت "ليش هذا التصميم؟" بعد 6 أشهر، لازم يكون في إجابة موثّقة



\## متى لا ننشئ ADR؟



\- إصلاحات صغيرة، typos

\- imports refactoring

\- اختيار library صغيرة بدون trade-offs مهمة



\## Format



كل ADR ملف بـ format:

\- `NNN-short-title.md` (NNN رقم متسلسل 001, 002, ...)

\- يحتوي: Status, Date, Context, Decision, Alternatives, Consequences



\## ADRs الحالية



| # | العنوان | الحالة |

|---|---------|--------|

| 001 | Multi-Workspace Architecture | Accepted |

| 002 | Workspace State via URL Params | Accepted |

