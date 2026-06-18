'use client';

import { LoginEmailStep } from './login-email-step';
import { LoginOtpStep } from './login-otp-step';
import { useLoginForm } from './use-login-form';

interface LoginFormProps {
  callbackUrl: string;
  initialErrorCode: string | null;
}

export const LoginForm = ({
  callbackUrl,
  initialErrorCode,
}: LoginFormProps) => {
  const state = useLoginForm({ callbackUrl, initialErrorCode });

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
