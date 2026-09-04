'use client';

import { useState } from 'react';

import type { SignupOrigin } from '@/lib/utils/signup-origin';

import { LoginEmailStep } from './login-email-step';
import { LoginOtpStep } from './login-otp-step';
import { LoginPasswordStep } from './login-password-step';
import type { SignInMethods } from './sign-in-methods';

type LoginStep =
  | { name: 'password' }
  | { name: 'email' }
  | { name: 'otp'; email: string };

interface LoginFormProps {
  methods: SignInMethods;
  /** Only the entry step is co-branded; later steps stay focused on the code. */
  signupOrigin: SignupOrigin | null;
}

export const LoginForm = ({ methods, signupOrigin }: LoginFormProps) => {
  const [step, setStep] = useState<LoginStep>(
    methods.password ? { name: 'password' } : { name: 'email' },
  );

  if (step.name === 'otp') {
    return (
      <LoginOtpStep
        email={step.email}
        onUseDifferentEmail={() => setStep({ name: 'email' })}
      />
    );
  }

  if (step.name === 'password') {
    return (
      <LoginPasswordStep
        showGoogle={methods.google}
        onUseEmailCode={
          methods.emailOtp ? () => setStep({ name: 'email' }) : undefined
        }
      />
    );
  }

  return (
    <LoginEmailStep
      showGoogle={methods.google}
      signupOrigin={signupOrigin}
      onUsePassword={
        methods.password ? () => setStep({ name: 'password' }) : undefined
      }
      onOtpSent={(email) => setStep({ name: 'otp', email })}
    />
  );
};
