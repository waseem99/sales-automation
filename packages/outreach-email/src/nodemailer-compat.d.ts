import 'nodemailer/lib/smtp-pool';

declare module 'nodemailer/lib/smtp-pool' {
  interface SentMessageInfo {
    pending: string[];
  }
}
