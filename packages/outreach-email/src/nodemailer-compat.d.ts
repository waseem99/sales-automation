import 'nodemailer';
import type { Transporter } from 'nodemailer';

declare module 'nodemailer' {
  function createTransport(options?: unknown): Transporter<unknown>;
}
