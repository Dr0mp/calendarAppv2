import { t } from '../i18n/index.js';
import { passwordPolicyError, PASSWORD_MIN, PASSWORD_MAX } from '/shared/rules/password.js';

/** Translate a password policy code, with the numbers filled in. @param {string} code */
export function passwordErrorText(code) {
  return t(`errors.${code}`, { min: PASSWORD_MIN, max: PASSWORD_MAX });
}

/** Local policy check for instant feedback. @param {string} pw @param {{username?: string, email?: string|null}} ctx */
export function localPasswordError(pw, ctx) {
  const code = passwordPolicyError(pw, ctx);
  return code ? passwordErrorText(code) : null;
}
