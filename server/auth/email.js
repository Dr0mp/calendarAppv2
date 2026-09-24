import nodemailer from 'nodemailer';

/**
 * @typedef {{to: string, subject: string, text: string}} Mail
 * @typedef {{configured: boolean, send: (m: Mail) => Promise<void>, outbox?: Mail[]}} Mailer
 */

/**
 * Email is on when SMTP_URL is set. In tests, SMTP_URL=test://outbox keeps
 * messages in memory (the "test SMTP sink"). With no SMTP the admin copies links.
 * @param {{smtpUrl: string, mailFrom: string, isTest: boolean}} config
 * @param {import('pino').Logger} log
 * @returns {Mailer}
 */
export function createMailer(config, log) {
  if (!config.smtpUrl) {
    return {
      configured: false,
      async send(m) {
        log.info({ subject: m.subject }, 'email is not configured; message not sent');
      },
    };
  }
  if (config.smtpUrl.startsWith('test://')) {
    if (!config.isTest) throw new Error('SMTP_URL=test:// is only allowed with NODE_ENV=test');
    /** @type {Mail[]} */ const outbox = [];
    return {
      configured: true,
      outbox,
      async send(m) {
        outbox.push(m);
      },
    };
  }
  const transport = nodemailer.createTransport(config.smtpUrl);
  return {
    configured: true,
    async send(m) {
      await transport.sendMail({ from: config.mailFrom || undefined, to: m.to, subject: m.subject, text: m.text });
    },
  };
}

const T = {
  ro: {
    invite: {
      subject: 'Invitație în Casa Artis Calendar',
      text: (name, link) =>
        `Bună, ${name}!\n\nAți fost invitat(ă) în Casa Artis Calendar. Alegeți o parolă folosind linkul de mai jos (valabil 72 de ore):\n\n${link}\n\nDacă nu vă așteptați la acest email, îl puteți ignora.`,
    },
    reset: {
      subject: 'Resetarea parolei — Casa Artis Calendar',
      text: (name, link) =>
        `Bună, ${name}!\n\nAm primit o cerere de resetare a parolei. Folosiți linkul de mai jos (valabil 60 de minute):\n\n${link}\n\nDacă nu ați cerut resetarea, ignorați acest email; parola rămâne neschimbată.`,
    },
    test: { subject: 'Email de test — Casa Artis Calendar', text: () => 'Configurarea emailului funcționează.' },
  },
  en: {
    invite: {
      subject: 'Invitation to Casa Artis Calendar',
      text: (name, link) =>
        `Hello ${name},\n\nYou have been invited to Casa Artis Calendar. Choose a password with the link below (valid for 72 hours):\n\n${link}\n\nIf you weren't expecting this email, you can ignore it.`,
    },
    reset: {
      subject: 'Password reset — Casa Artis Calendar',
      text: (name, link) =>
        `Hello ${name},\n\nWe received a request to reset your password. Use the link below (valid for 60 minutes):\n\n${link}\n\nIf you didn't ask for this, ignore this email; your password stays the same.`,
    },
    test: { subject: 'Test email — Casa Artis Calendar', text: () => 'Your email settings work.' },
  },
};

/**
 * @param {'invite'|'reset'|'test'} kind
 * @param {string|null|undefined} locale
 * @param {string} name
 * @param {string} [link]
 */
export function composeMail(kind, locale, name, link = '') {
  const t = T[locale === 'en' ? 'en' : 'ro'][kind];
  return { subject: t.subject, text: t.text(name, link) };
}
