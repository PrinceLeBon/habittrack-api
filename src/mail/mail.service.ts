import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger('MailService');
  private readonly transporter: Transporter = createTransport({
    host: process.env.SMTP_HOST ?? 'localhost',
    port: Number(process.env.SMTP_PORT ?? 1025),
    secure: false,
  });

  /** Envoie le code OTP sans jamais faire échouer la requête : l'envoi part en arrière-plan. */
  sendOtp(email: string, name: string, code: string): void {
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log(`Code OTP pour ${email} : ${code}`);
    }
    this.transporter
      .sendMail({
        from: process.env.MAIL_FROM ?? 'HabitTrack <no-reply@habittrack.local>',
        to: email,
        subject: 'Votre code de vérification HabitTrack',
        text: `Bonjour ${name},\n\nVotre code de vérification est : ${code}\nIl expire dans 15 minutes.\n\nL'équipe HabitTrack`,
      })
      .catch((error: Error) => this.logger.warn(`E-mail non envoyé (${error.message})`));
  }
}
