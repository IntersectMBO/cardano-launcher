module.exports = {
  parser: "@typescript-eslint/parser", // Use TypeScript parser for eslint
  parserOptions: {
    project: "./tsconfig.eslint.json",
    ecmaVersion:  2018,  // Allows for the parsing of modern ECMAScript features
    sourceType: 'module',  // Allows for the use of imports
  },
  extends: [
    'prettier/@typescript-eslint',
    'plugin:prettier/recommended', // format sources with prettier.io
    // Uses the recommended rules from the @typescript-eslint/eslint-plugin
    'plugin:@typescript-eslint/recommended',
    // Recommended by https://www.npmjs.com/package/eslint-plugin-jest
    'plugin:jest/recommended',
    // Optional pedantic stuff
    'plugin:jest/style',
  ],
  plugins: [
    "@typescript-eslint",
    "jest",
    "prettier",
  ],
  globals: {
    "it": "readonly",
    "before": "readonly",
    "after": "readonly",
    "describe": "readonly",
    "beforeEach": "readonly",
    "afterEach": "readonly"
  },
  rules: {
    "prettier/prettier": "error",
    "no-unused-vars": 0,
    "linebreak-style": [
      2,
      "unix"
    ],
    "no-unused-expressions": 0,
    "@typescript-eslint/no-floating-promises": "warn"
  },
  env: {
    jest: true
  },
};
