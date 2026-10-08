import "server-only";
import nodemailer from "nodemailer";

// Optional: with SMTP_URL (for example smtps://user:password@smtp.example.com:465) and MAIL_FROM set, documents can be
// emailed straight from Hakiki. Without them the Email buttons open the user's own mail app instead.
export function mailConfigured(): boolean {
  return !!process.env.SMTP_URL && !!process.env.MAIL_FROM;
}

export async function sendMail(input: { to: string; subject: string; text: string; replyTo?: string | null }) {
  if (!mailConfigured()) throw new Error("Email sending is not set up");
  const transport = nodemailer.createTransport(process.env.SMTP_URL!);
  await transport.sendMail({
    from: process.env.MAIL_FROM,
    to: input.to,
    subject: input.subject,
    text: input.text,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
  });
}
