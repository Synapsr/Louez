'use client';

import { useState } from 'react';

import { LoginEmailStep } from './login-email-step';
import { LoginOtpStep } from './login-otp-step';

type LoginStep = { name: 'email' } | { name: 'otp'; email: string };

export const LoginForm = () => {
  const [step, setStep] = useState<LoginStep>({ name: 'email' });

  if (step.name === 'otp') {
    return (
      <LoginOtpStep
        email={step.email}
        onUseDifferentEmail={() => setStep({ name: 'email' })}
      />
    );
  }

  return (
    <LoginEmailStep onOtpSent={(email) => setStep({ name: 'otp', email })} />
  );
};
