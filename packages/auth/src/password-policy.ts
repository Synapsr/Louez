// Single source for the password rule: the better-auth config enforces it and
// the forms display it, so the checklist can never promise something the
// server refuses. No server import here — client components read it too.
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
