// ─── Single Sign-On (Google / Microsoft) ───────────────────────────────────────
// Demo-mode by default: clicking "Continue with Google/Microsoft" signs the user
// into the shared demo account so the flow can be explored without real OAuth
// credentials. The moment GOOGLE_CLIENT_ID/SECRET or MICROSOFT_CLIENT_ID/SECRET
// are present, the same buttons perform a real OAuth2 authorization-code flow.

const PROVIDERS = {
  google: {
    name: 'Google',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    scope: 'openid email profile',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
  },
  microsoft: {
    name: 'Microsoft',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userInfoUrl: 'https://graph.microsoft.com/oidc/userinfo',
    scope: 'openid email profile',
    clientIdEnv: 'MICROSOFT_CLIENT_ID',
    clientSecretEnv: 'MICROSOFT_CLIENT_SECRET',
  },
};

function isConfigured(provider) {
  const p = PROVIDERS[provider];
  if (!p) return false;
  return !!(process.env[p.clientIdEnv] && process.env[p.clientSecretEnv]);
}

module.exports = { PROVIDERS, isConfigured };
