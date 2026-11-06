// Seam for sign-in. Phase 1 full game will replace `anonymousSession` with a thirdweb-backed session
// (Google/passkey), or a zero-click MiniPay session. Nothing here talks to a wallet or server.
export type AuthSession =
  | { kind: 'anonymous' };

export const anonymousSession: AuthSession = { kind: 'anonymous' };
