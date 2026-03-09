import nodemailer from 'nodemailer';
import { config } from './config.js';

export function mailEnabled() {
  return Boolean(config.MAIL_ENABLED && config.MAIL_TO && config.SMTP_HOST);
}

function createTransport() {
  return nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: (config.SMTP_USER && config.SMTP_PASS) ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    ignoreTLS: config.SMTP_IGNORE_TLS,
    tls: {
      rejectUnauthorized: config.SMTP_TLS_REJECT_UNAUTHORIZED
    }
  });
}

export async function sendMail(subject, text, logger = console) {
  if (!mailEnabled()) {
    logger.info({ subject }, 'Mail disabled');
    return;
  }

  const transporter = createTransport();
  const from = config.SMTP_USER || `flights@${config.HOST}`;

  await transporter.sendMail({
    from,
    to: config.MAIL_TO,
    subject,
    text
  });

  logger.info({ subject, to: config.MAIL_TO }, 'Mail sent');
}
