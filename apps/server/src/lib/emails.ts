import { appUrl } from "../config/env";

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(heading: string, body: string, cta: { label: string; url: string }) {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f7;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#fff;border-radius:16px;padding:32px">
<tr><td><h1 style="margin:0 0 16px;font-size:20px;color:#111">${heading}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#444">${body}</p>
<a href="${cta.url}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">${cta.label}</a>
<p style="margin:24px 0 0;font-size:13px;color:#888">If the button doesn't work, paste this link into your browser:<br><span style="word-break:break-all">${cta.url}</span></p>
</td></tr></table></td></tr></table></body></html>`;
}

export function verifyEmail(name: string, token: string) {
  const url = `${appUrl}/verify-email?token=${encodeURIComponent(token)}`;
  return {
    subject: "Verify your email",
    text: `Hi ${name},\n\nConfirm your email address to finish setting up your account:\n${url}\n\nThis link expires in 24 hours.`,
    html: layout(
      "Confirm your email",
      `Hi ${escapeHtml(name)}, confirm your email address to finish setting up your account. This link expires in 24 hours.`,
      { label: "Verify email", url },
    ),
  };
}

export function resetPassword(name: string, token: string) {
  const url = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;
  return {
    subject: "Reset your password",
    text: `Hi ${name},\n\nSomeone (hopefully you) asked to reset your password:\n${url}\n\nThis link expires in 1 hour. If you didn't ask for this, you can ignore this email.`,
    html: layout(
      "Reset your password",
      `Hi ${escapeHtml(name)}, use the button below to choose a new password. This link expires in 1 hour. If you didn't ask for this, you can safely ignore this email.`,
      { label: "Reset password", url },
    ),
  };
}
