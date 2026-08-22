import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { EmailMessage, IEmailSender } from './email-sender.interface';

/**
 * SMTP transport, via Nodemailer.
 *
 * ⚠️ This is the ONLY file in the repository allowed to import nodemailer.
 * Everything else depends on the EMAIL_SENDER port. Keeping the import here is
 * what makes the transport replaceable; scattering it makes it permanent.
 */
@Injectable()
export class SmtpEmailSender implements IEmailSender {
  private readonly transporter: Transporter;
  private readonly from: { name: string; address: string };

  constructor(configService: ConfigService) {
    const user = configService.get<string>('SMTP_USER');
    const password = configService.get<string>('SMTP_PASSWORD');

    this.transporter = createTransport({
      host: configService.getOrThrow<string>('SMTP_HOST'),
      port: configService.getOrThrow<number>('SMTP_PORT'),
      secure: configService.getOrThrow<boolean>('SMTP_SECURE'),
      // Mailpit accepts unauthenticated SMTP; a real relay will not. Auth is
      // attached only when BOTH credentials are present — the env schema keeps
      // them together, so a half-configured relay is caught at boot instead of
      // connecting anonymously and being refused at delivery time.
      ...(user && password ? { auth: { user, pass: password } } : {}),
    });

    this.from = {
      name: configService.getOrThrow<string>('EMAIL_FROM_NAME'),
      address: configService.getOrThrow<string>('EMAIL_FROM_ADDRESS'),
    };
  }

  async send(message: EmailMessage): Promise<void> {
    // A throw here fails the job, which is what drives the retry policy. It is
    // deliberately not caught: swallowing it would make a mail that never left
    // look exactly like one that did.
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}
