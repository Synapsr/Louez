import { z } from 'zod';

import { env } from '@/env';

export const GOOGLE_CALENDAR_PROVIDER_KEY = 'google-calendar';
export const GOOGLE_CALENDAR_CATEGORY = 'calendar';
export const GOOGLE_CALENDAR_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.app.created',
] as const;

const googleTokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  id_token: z.string().optional(),
});

const googleRefreshResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().int().positive().optional(),
  scope: z.string().optional(),
});

const googleUserInfoSchema = z.object({
  email: z.email().optional(),
});

const googleCalendarSchema = z.object({
  id: z.string(),
  summary: z.string().optional(),
});

const googleEventSchema = z.object({
  id: z.string(),
});

export class GoogleCalendarApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'GoogleCalendarApiError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type GoogleCalendarEventInput = {
  summary: string;
  description: string;
  startDate: Date;
  endDate: Date;
  status: 'confirmed' | 'tentative';
  transparency: 'opaque' | 'transparent';
  visibility: 'default' | 'public' | 'private' | 'confidential';
  colorId: string;
  url: string;
};

function getGoogleCalendarEnv(): {
  clientId: string;
  clientSecret: string;
} {
  if (!env.GOOGLE_CALENDAR_CLIENT_ID || !env.GOOGLE_CALENDAR_CLIENT_SECRET) {
    throw new Error('Google Calendar OAuth is not configured');
  }

  return {
    clientId: env.GOOGLE_CALENDAR_CLIENT_ID,
    clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET,
  };
}

export function getGoogleCalendarRedirectUri(): string {
  return `${env.NEXT_PUBLIC_APP_URL}/api/integrations/google-calendar/oauth/callback`;
}

export function buildGoogleCalendarAuthorizationUrl(state: string): string {
  const { clientId } = getGoogleCalendarEnv();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');

  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', getGoogleCalendarRedirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_CALENDAR_SCOPES.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);

  return url.toString();
}

export async function exchangeGoogleCalendarCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
  scopes: string | null;
}> {
  const { clientId, clientSecret } = getGoogleCalendarEnv();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getGoogleCalendarRedirectUri(),
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    throw new GoogleCalendarApiError(
      `Google token exchange failed (${response.status})`,
      response.status,
    );
  }

  const token = googleTokenResponseSchema.parse(await response.json());
  if (!token.refresh_token) {
    throw new Error('Google did not return a refresh token');
  }

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000)
      : null,
    scopes: token.scope ?? null,
  };
}

export async function refreshGoogleCalendarAccessToken(
  refreshToken: string,
): Promise<{
  accessToken: string;
  expiresAt: Date | null;
  scopes: string | null;
}> {
  const { clientId, clientSecret } = getGoogleCalendarEnv();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    throw new GoogleCalendarApiError(
      `Google token refresh failed (${response.status})`,
      response.status,
    );
  }

  const token = googleRefreshResponseSchema.parse(await response.json());

  return {
    accessToken: token.access_token,
    expiresAt: token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000)
      : null,
    scopes: token.scope ?? null,
  };
}

export async function getGoogleAccountEmail(
  accessToken: string,
): Promise<string | null> {
  const response = await fetch(
    'https://www.googleapis.com/oauth2/v2/userinfo',
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) return null;

  const userInfo = googleUserInfoSchema.parse(await response.json());
  return userInfo.email ?? null;
}

export async function createGoogleCalendar(params: {
  accessToken: string;
  summary: string;
}): Promise<{ id: string; summary: string }> {
  const response = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: params.summary,
        timeZone: 'Europe/Paris',
      }),
    },
  );

  if (!response.ok) {
    throw new GoogleCalendarApiError(
      `Google Calendar creation failed (${response.status})`,
      response.status,
    );
  }

  const calendar = googleCalendarSchema.parse(await response.json());
  return { id: calendar.id, summary: calendar.summary ?? params.summary };
}

function toGoogleEvent(input: GoogleCalendarEventInput) {
  return {
    summary: input.summary,
    description: input.description,
    start: {
      dateTime: input.startDate.toISOString(),
      timeZone: 'Europe/Paris',
    },
    end: {
      dateTime: input.endDate.toISOString(),
      timeZone: 'Europe/Paris',
    },
    status: input.status,
    transparency: input.transparency,
    visibility: input.visibility,
    colorId: input.colorId,
    source: {
      title: 'Louez',
      url: input.url,
    },
  };
}

export async function insertGoogleCalendarEvent(params: {
  accessToken: string;
  calendarId: string;
  event: GoogleCalendarEventInput;
}): Promise<{ id: string }> {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(params.calendarId)}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(toGoogleEvent(params.event)),
    },
  );

  if (!response.ok) {
    throw new GoogleCalendarApiError(
      `Google Calendar event insert failed (${response.status})`,
      response.status,
    );
  }

  return googleEventSchema.parse(await response.json());
}

export async function updateGoogleCalendarEvent(params: {
  accessToken: string;
  calendarId: string;
  eventId: string;
  event: GoogleCalendarEventInput;
}): Promise<{ id: string }> {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(params.calendarId)}/events/${encodeURIComponent(params.eventId)}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(toGoogleEvent(params.event)),
    },
  );

  if (!response.ok) {
    throw new GoogleCalendarApiError(
      `Google Calendar event update failed (${response.status})`,
      response.status,
    );
  }

  return googleEventSchema.parse(await response.json());
}

export async function deleteGoogleCalendarEvent(params: {
  accessToken: string;
  calendarId: string;
  eventId: string;
}): Promise<void> {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(params.calendarId)}/events/${encodeURIComponent(params.eventId)}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
      },
    },
  );

  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new GoogleCalendarApiError(
      `Google Calendar event delete failed (${response.status})`,
      response.status,
    );
  }
}
