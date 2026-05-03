import { NextRequest, NextResponse } from "next/server";

// Escape user input before embedding in HTML to prevent XSS in the email body.
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface ContactBody {
  name?: string;
  email?: string;
  subject?: string;
  message?: string;
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error("RESEND_API_KEY is not configured");
      return NextResponse.json(
        { error: "خدمة البريد الإلكتروني غير مهيأة حالياً." },
        { status: 500 }
      );
    }

    const body = (await request.json()) as ContactBody;
    const name = body.name?.trim() ?? "";
    const email = body.email?.trim() ?? "";
    const subject = body.subject?.trim() ?? "";
    const message = body.message?.trim() ?? "";

    // Server-side validation (mirrors client-side, never trust the client)
    if (!name || !email || !subject || !message) {
      return NextResponse.json(
        { error: "جميع الحقول مطلوبة" },
        { status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "البريد الإلكتروني غير صحيح" },
        { status: 400 }
      );
    }

    if (message.length < 10) {
      return NextResponse.json(
        { error: "الرسالة يجب أن تكون 10 أحرف على الأقل" },
        { status: 400 }
      );
    }

    // Branded HTML template for the inbound email
    const html = `
<div style="font-family: 'Tajawal', Arial, sans-serif; max-width: 600px; margin: 0 auto; direction: rtl; text-align: right; background: #f9fafb; padding: 20px;">
  <div style="background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%); padding: 28px 24px; border-radius: 12px 12px 0 0; color: white;">
    <h1 style="margin: 0; font-size: 22px; font-weight: 700;">رسالة جديدة من موقع ArabiaDash</h1>
    <p style="margin: 8px 0 0; font-size: 14px; opacity: 0.9;">تم إرسالها عبر صفحة "تواصل معنا"</p>
  </div>
  <div style="background: #ffffff; padding: 28px 24px; border: 1px solid #e5e7eb; border-top: 0;">
    <h2 style="margin: 0 0 16px; color: #4f46e5; font-size: 16px; font-weight: 700;">تفاصيل المرسل</h2>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #374151;">
      <tr>
        <td style="padding: 8px 0; width: 100px; color: #6b7280; font-weight: 600;">الاسم:</td>
        <td style="padding: 8px 0;">${escapeHtml(name)}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #6b7280; font-weight: 600;">الإيميل:</td>
        <td style="padding: 8px 0;" dir="ltr"><a href="mailto:${escapeHtml(email)}" style="color: #4f46e5; text-decoration: none;">${escapeHtml(email)}</a></td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #6b7280; font-weight: 600;">الموضوع:</td>
        <td style="padding: 8px 0; font-weight: 600;">${escapeHtml(subject)}</td>
      </tr>
    </table>
  </div>
  <div style="background: #ffffff; padding: 0 24px 28px; border: 1px solid #e5e7eb; border-top: 0;">
    <h2 style="margin: 0 0 12px; color: #4f46e5; font-size: 16px; font-weight: 700;">نص الرسالة</h2>
    <div style="background: #f9fafb; padding: 16px; border-radius: 8px; border-right: 4px solid #6366f1; font-size: 14px; line-height: 1.7; color: #374151; white-space: pre-wrap;">${escapeHtml(message)}</div>
  </div>
  <div style="background: #ffffff; padding: 16px 24px; border: 1px solid #e5e7eb; border-top: 0; border-radius: 0 0 12px 12px; text-align: center; color: #9ca3af; font-size: 12px;">
    ArabiaDash © 2026 — يمكنك الرد مباشرة على هذا الإيميل للتواصل مع المرسل.
  </div>
</div>`;

    // Call Resend's REST API directly (no SDK dependency required).
    // To switch to the official SDK, run `npm install resend` and replace the
    // fetch with `await new Resend(apiKey).emails.send(...)`.
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: "ArabiaDash <onboarding@resend.dev>",
        to: "alkhateib94@gmail.com",
        reply_to: email,
        subject: `[ArabiaDash Contact] ${subject}`,
        html,
      }),
    });

    if (!resendResponse.ok) {
      const errorPayload = await resendResponse
        .json()
        .catch(() => ({ message: resendResponse.statusText }));
      console.error("Resend API error:", errorPayload);
      return NextResponse.json(
        { error: "فشل إرسال الرسالة. يرجى المحاولة مرة أخرى لاحقاً." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Contact API error:", err);
    return NextResponse.json(
      { error: "حدث خطأ في الخادم. يرجى المحاولة مرة أخرى." },
      { status: 500 }
    );
  }
}
