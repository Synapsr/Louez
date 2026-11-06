'use client';

import { useState } from 'react';

import type { SignupOrigin } from '@/lib/utils/signup-origin';

import { LoginEmailStep } from './login-email-step';
import { LoginNewPasswordStep } from './login-new-password-step';
import { LoginOtpStep } from './login-otp-step';
import { LoginPasswordStep } from './login-password-step';
import { LoginResetRequestStep } from './login-reset-request-step';
import type { SignInMethods } from './sign-in-methods';
import { useLastSignInMethod } from './use-last-sign-in-method';
import { resolveInitialLoginStep } from './util.last-sign-in-method';

type LoginStep =
  | { name: 'password' }
  | { name: 'email' }
  | { name: 'otp'; email: string }
  // Forgot password: e-mail → 6-digit code → new password → signed in.
  | { name: 'resetRequest' }
  | { name: 'resetCode'; email: string }
  | { name: 'resetPassword'; email: string; otp: string };

interface LoginFormProps {
  methods: SignInMethods;
  /** Only the entry step is co-branded; later steps stay focused on the code. */
  signupOrigin: SignupOrigin | null;
}

export const LoginForm = ({ methods, signupOrigin }: LoginFormProps) => {
  const lastMethod = useLastSignInMethod();
  // Null until the visitor navigates: the entry step is derived, so the
  // remembered method can still take over once it is read after hydration.
  const [selectedStep, setSelectedStep] = useState<LoginStep | null>(null);
  const step = selectedStep ?? {
    name: resolveInitialLoginStep(methods, lastMethod),
  };

  if (step.name === 'otp') {
    return (
      <LoginOtpStep
        email={step.email}
        onUseDifferentEmail={() => setSelectedStep({ name: 'email' })}
      />
    );
  }

  if (step.name === 'resetRequest') {
    return (
      <LoginResetRequestStep
        emailDelivery={methods.emailOtp}
        onCodeSent={(email) => setSelectedStep({ name: 'resetCode', email })}
        onBack={() => setSelectedStep({ name: 'password' })}
      />
    );
  }

  if (step.name === 'resetCode') {
    const { email } = step;

    return (
      <LoginOtpStep
        email={email}
        flow={{
          purpose: 'forget-password',
          onVerified: (otp) =>
            setSelectedStep({ name: 'resetPassword', email, otp }),
        }}
        onUseDifferentEmail={() => setSelectedStep({ name: 'resetRequest' })}
      />
    );
  }

  if (step.name === 'resetPassword') {
    return (
      <LoginNewPasswordStep
        email={step.email}
        otp={step.otp}
        onRequestNewCode={() => setSelectedStep({ name: 'resetRequest' })}
      />
    );
  }

  if (step.name === 'password') {
    return (
      <LoginPasswordStep
        showGoogle={methods.google}
        allowSignUp={methods.password === 'primary'}
        onForgotPassword={() => setSelectedStep({ name: 'resetRequest' })}
        onUseEmailCode={
          methods.emailOtp
            ? () => setSelectedStep({ name: 'email' })
            : undefined
        }
      />
    );
  }

  return (
    <LoginEmailStep
      showGoogle={methods.google}
      signupOrigin={signupOrigin}
      onUsePassword={
        methods.password
          ? () => setSelectedStep({ name: 'password' })
          : undefined
      }
      onOtpSent={(email) => setSelectedStep({ name: 'otp', email })}
    />
  );
};
