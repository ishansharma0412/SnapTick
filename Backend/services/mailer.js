// Outgoing email. Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and MAIL_FROM
// (for Gmail: smtp.gmail.com, 465, the address and an App Password). Without SMTP
// settings, messages are written to the server log so flows can still be tested.
const nodemailer = require("nodemailer");

const configured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const transport = configured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: Number(process.env.SMTP_PORT || 465) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

const FROM = process.env.MAIL_FROM || process.env.SMTP_USER || "SnapTick <no-reply@snaptick.local>";

async function sendMail({ to, subject, text }) {
  if (!to) return { sent: false, reason: "no recipient" };
  if (!transport) {
    console.log(`[mail:not-configured] to=${to} subject="${subject}"\n${text}\n[/mail]`);
    return { sent: false, reason: "smtp not configured", logged: true };
  }
  await transport.sendMail({ from: FROM, to, subject, text });
  return { sent: true };
}

module.exports = { sendMail, mailConfigured: configured };
