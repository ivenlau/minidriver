import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser'
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import { api } from './api'

export { browserSupportsWebAuthn, platformAuthenticatorIsAvailable }

export async function registerPasskey(name?: string): Promise<void> {
  const options = await api.get<PublicKeyCredentialCreationOptionsJSON>(
    '/api/auth/webauthn/register/options',
  )
  const credential = await startRegistration({ optionsJSON: options })
  await api.post('/api/auth/webauthn/register', { credential, name })
}

export async function loginWithPasskey(useAutofill = false): Promise<void> {
  const options = await api.get<PublicKeyCredentialRequestOptionsJSON>(
    '/api/auth/webauthn/login/options',
  )
  const credential = await startAuthentication({ optionsJSON: options, useBrowserAutofill: useAutofill })
  await api.post('/api/auth/webauthn/login', { credential })
}
