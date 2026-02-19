import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    files: ['**/*.{js,mjs,cjs,jsx,ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/static-components': 'off',
      'react/no-unescaped-entities': 'off',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/lib/pricing', '@/lib/pricing/*'],
              message: 'Use @louez/utils pricing exports instead of local pricing modules.',
            },
            {
              group: ['@/types/*'],
              message: 'Use @louez/types instead of local app types.',
            },
            {
              group: ['@/components/ui/logo'],
              message: 'Use Logo exports from @louez/ui.',
            },
            {
              group: ['../../lib/db/schema'],
              message: 'Use schema exports from @louez/db.',
            },
            {
              group: ['../../types'],
              message: 'Use type exports from @louez/types.',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ['.next/**', 'node_modules/**', 'dist/**', 'build/**'],
  },
];

export default config;
