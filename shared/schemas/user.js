import { z } from 'zod';
import { email, locale, optText, ownerColor, text, theme } from './common.js';

export { email };

export const username = z
  .string()
  .regex(/^[a-z0-9._-]{3,32}$/, 'invalid_username');

export const role = z.enum(['user', 'moderator', 'admin']);

export const InviteUser = z.strictObject({
  name: text(80),
  username,
  email,
  role,
  color: ownerColor.optional(),
});

export const UpdateUser = z.strictObject({
  name: text(80).optional(),
  username: username.optional(),
  email: email.optional(),
  role: role.optional(),
  color: ownerColor.optional(),
  initials: optText(3).optional(),
});

export const UpdateMe = z.strictObject({
  name: text(80).optional(),
  email: email.optional(),
  locale: locale.optional(),
  theme: theme.optional(),
});

export const DeleteUser = z.strictObject({ transferTo: z.string().nullish() });
