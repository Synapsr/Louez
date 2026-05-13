'use client';

import { LoginCard } from './login-card';
import { LoginEmailStep } from './login-email-step';
import { LoginOtpStep } from './login-otp-step';
import { useLoginForm } from './use-login-form';

interface LoginFormProps {
  callbackUrl: string;
  initialErrorCode: string | null;
  refCode: string | null;
}

export const LoginForm = ({
  callbackUrl,
  initialErrorCode,
  refCode,
}: LoginFormProps) => {
  const state = useLoginForm({ callbackUrl, initialErrorCode, refCode });

  return (
    <>
      {state.otpSent ? (
        <LoginOtpStep state={state} />
      ) : (
        <LoginEmailStep state={state} />
      )}
    </>
  );
};
