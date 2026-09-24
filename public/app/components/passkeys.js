import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import { api } from '../api.js';

export const passkeysSupported = () => window.isSecureContext && browserSupportsWebAuthn();

/**
 * Register a new passkey for the signed-in user.
 * @param {string} [name]
 */
export async function addPasskey(name) {
  const optionsJSON = await api('POST', '/me/passkeys/options', { body: {} });
  const response = await startRegistration({ optionsJSON });
  return api('POST', '/me/passkeys', { body: { name: name || undefined, response } });
}
