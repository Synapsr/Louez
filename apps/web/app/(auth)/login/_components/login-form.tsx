'use client';

import { useState } from 'react';

import { LoginEmailStep } from './login-email-step';
import { LoginOtpStep } from './login-otp-step';
import { LoginPasswordStep } from './login-password-step';
import type { SignInMethods } from './sign-in-methods';

type LoginStep =
  | { name: 'password' }
  | { name: 'email' }
  | { name: 'otp'; email: string };

export const LoginForm = ({ methods }: { methods: SignInMethods }) => {
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
      onUsePassword={
        methods.password ? () => setStep({ name: 'password' }) : undefined
      }
      onOtpSent={(email) => setStep({ name: 'otp', email })}
    />
  );
};
