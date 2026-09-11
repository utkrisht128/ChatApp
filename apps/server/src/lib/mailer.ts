import nodemailer from "nodemailer";
import { env, isProd } from "../config/env";
import { logger } from "./logger";

const transport = env.SMTP_URL ? nodemailer.createTransport(env.SMTP_URL) : null;

type Mail = { to: string; subject: string; text: string; html: string };

/**
 * Sends an email. Never throws — a mail outage must not break signup or login.
 * Without SMTP configured, development prints the email (including its link) to the
 * console so the flow can be tested; production only logs that sending was skipped.
 */
export async function sendMail(mail: Mail) {
  if (!transport) {
    if (isProd) logger.warn({ subject: mail.subject }, "SMTP_URL not configured — email not sent");
    else logger.info(`\n── Email to ${mail.to} ──\n${mail.subject}\n\n${mail.text}\n──────────`);
    return;
  }
  try {
    await transport.sendMail({ from: env.MAIL_FROM, ...mail });
  } catch (err) {
    logger.error({ err, subject: mail.subject }, "Failed to send email");
  }
}
