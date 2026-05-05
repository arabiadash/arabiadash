# 🌐 ArabiaDash - Domain Setup

> Production deployment configuration and migration documentation.

## 📍 Domain Configuration

| Type | Domain | Status |
|------|--------|--------|
| **Production** (canonical) | `arabiadash.com` | ✅ Active |
| **WWW Redirect** | `www.arabiadash.com` | 🔄 308 → `arabiadash.com` |
| **Vercel Fallback** | `arabiadash.vercel.app` | ✅ Active (backup) |

**Provider**: GoDaddy  
**SSL**: Auto-managed by Vercel  
**Migration Date**: May 5, 2026

## 🔧 DNS Records (GoDaddy)

| Type | Name | Value |
|------|------|-------|
| A | @ | 216.198.79.1 |
| CNAME | www | 2c6d2aa2024e7eb1.vercel-dns-017.com |

## ⚙️ Vercel Environment Variables

### Project Scope
- `NEXT_PUBLIC_SITE_URL` = `https://arabiadash.com`
- `NEXT_PUBLIC_SUPABASE_URL` = `https://fkljjwfhmmletytvevbp.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = *[secret]*
- `RESEND_API_KEY` = *[secret]*

### Shared Scope
- `SUPABASE_SERVICE_ROLE_KEY` = *[secret]*

> ⚠️ **Important**: `NEXT_PUBLIC_SUPABASE_URL` MUST be the Supabase URL (not your domain).  
> Setting it to `arabiadash.com` will break OAuth and email signup.

## 🔐 Supabase Auth Configuration

**Site URL**: `https://arabiadash.com`

**Redirect URLs (Allow List)**:
- `https://arabiadash.com/**`
- `https://www.arabiadash.com/**`
- `https://arabiadash.vercel.app/**`
- `http://localhost:3000/**`

## 📧 Custom SMTP (via Resend)

| Setting | Value |
|---------|-------|
| Provider | Resend |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Sender Email | `noreply@arabiadash.com` |
| Sender Name | `ArabiaDash` |
| Region | `ap-northeast-1` (Tokyo) |

### Resend DNS Records (verified)

| Type | Name | Status |
|------|------|--------|
| TXT (DKIM) | `resend._domainkey` | ✅ Verified |
| TXT (SPF) | `send` | ✅ Verified |
| MX | `send` | ✅ Verified (priority 10) |

## 🔑 OAuth Providers

### Google OAuth
- Configured via Supabase
- Callback URL handled by Supabase: `fkljjwfhmmletytvevbp.supabase.co/auth/v1/callback`
- Works seamlessly across all domains because callback goes through Supabase

## 💻 Local Development

In `.env.local`:
```bash
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://fkljjwfhmmletytvevbp.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
RESEND_API_KEY=...
```

Run: `npm run dev` → http://localhost:3000

## 🐛 Common Issues & Solutions

### 1. "404 on /auth/v1/authorize"
**Cause**: `NEXT_PUBLIC_SUPABASE_URL` was accidentally set to your domain.  
**Fix**: Restore it to `https://fkljjwfhmmletytvevbp.supabase.co`

### 2. Emails go to spam
**Status**: ✅ Mitigated via DKIM + SPF (verified by Resend)

### 3. OAuth redirect_uri_mismatch
**Cause**: New domain not in Supabase Redirect URLs.  
**Fix**: Add domain to Supabase → Auth → URL Configuration → Redirect URLs (with `/**` suffix)

### 4. Middleware not running (Next.js 16)
**Cause**: Next.js 16 deprecated `middleware.ts`.  
**Fix**: Use `src/proxy.ts` with `export function proxy()` (same level as `src/app/`)

## 📚 References

- [Vercel Domains](https://vercel.com/docs/projects/domains)
- [Supabase Auth URL Config](https://supabase.com/docs/guides/auth/concepts/redirect-urls)
- [Resend Custom Domains](https://resend.com/docs/dashboard/domains/introduction)
- [Next.js 16 Proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)
