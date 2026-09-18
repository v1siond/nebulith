/**
 * The engine's suite. It used to run through `next/jest`, which supplied an SWC transform, the `@/`
 * alias and a jsdom environment. There is no Next here any more, so each of those is stated directly
 * and @swc/jest does the transform next/jest was doing underneath.
 */
module.exports = {
  rootDir: '.',
  testEnvironment: 'jsdom',
  coverageProvider: 'v8',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/game/__tests__/helpers/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/game/$1',
  },
  transform: {
    '^.+\\.(t|j)sx?$': [
      '@swc/jest',
      {
        jsc: {
          target: 'es2022',
          parser: { syntax: 'typescript', tsx: true },
          transform: { react: { runtime: 'automatic' } },
        },
      },
    ],
  },
  collectCoverageFrom: ['game/**/*.{ts,tsx}', '!game/**/*.d.ts'],
  testMatch: ['**/__tests__/**/*.[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'],
}
