import { z } from 'zod';
import { PASSWORD_MAX } from '../rules/password.js';

// Passwords are never trimmed.
const password = z.string().min(1, 'required').max(PASSWORD_MAX * 4, 'too_long');

export const Login = z.strictObject({
  username: z.string().min(1, 'required').max(254),
  password,
});

export const DemoLogin = z.strictObject({ account: z.enum(['demo', 'demo_admin']) });

export const Forgot = z.strictObject({ login: z.string().trim().min(1, 'required').max(254) });

export const SetPassword = z.strictObject({ password });

export const ChangePassword = z.strictObject({ currentPassword: password, newPassword: password });

export const PasskeyName = z.strictObject({ name: z.string().trim().min(1, 'required').max(60, 'too_long') });

export const PasskeyRegister = z.strictObject({
  name: z.string().trim().max(60, 'too_long').optional(),
  response: z.record(z.string(), z.unknown()),
});
