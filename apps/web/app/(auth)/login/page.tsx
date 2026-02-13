import { LoginPageClient } from './_components/login-page-client';
import { sanitizeCallbackUrl } from './utils';

interface LoginPageProps {
  searchParams: Promise<{
    callbackUrl?: string;
    error?: string;
    ref?: string;
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;

  return (
    <LoginPageClient
      callbackUrl={sanitizeCallbackUrl(params.callbackUrl)}
      errorCode={params.error ?? null}
      refCode={params.ref ?? null}
    />
  );
}
