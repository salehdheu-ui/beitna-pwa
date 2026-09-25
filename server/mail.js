/* Password-reset mail is optional until the operator supplies a verified
   sender and a Resend API key. Never put those credentials in browser code. */
const KEY = String(process.env.RESEND_API_KEY || '').trim();
const FROM = String(process.env.RESET_MAIL_FROM || '').trim();
const enabled = !!(KEY && FROM);

async function sendPasswordReset(to, link) {
  if (!enabled) throw new Error('mail-not-configured');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      from: FROM, to: [to], subject: 'استعادة كلمة مرور بيتنا',
      text: `طلبت استعادة كلمة مرور بيتنا. افتح الرابط التالي خلال 15 دقيقة:\n\n${link}\n\nإن لم تطلب ذلك فتجاهل الرسالة.`,
    }),
  });
  if (!response.ok) throw new Error('mail-send-failed');
}

module.exports = { enabled, sendPasswordReset };
