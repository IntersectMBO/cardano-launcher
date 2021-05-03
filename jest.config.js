/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  preset: "ts-jest",
  globals: {
    'ts-jest': {
      tsconfig: "./tsconfig.eslint.json",
    },
  },
  testEnvironment: "node",
  roots: ["<rootDir>/dist/"],
  reporters: [
    ['default', { showStatus: true }],
    ['<rootDir>/dist/test/reporters/debug', { env: "DEBUG_REPORT" }],
  ],
};
