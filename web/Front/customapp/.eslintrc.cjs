/* eslint-env node */
require('@rushstack/eslint-patch/modern-module-resolution')

module.exports = {
  root: true,
  'extends': [
    'plugin:vue/vue3-essential',
    'eslint:recommended',
    '@vue/eslint-config-typescript',
    '@vue/eslint-config-prettier/skip-formatting'
  ],
  parserOptions: {
    ecmaVersion: 'latest'
  },
  // add your custom rules here
  // 0 : off
  // 1 : warning
  // 2 : error
  rules: {
    /* eslint-disable no-magic-numbers */
    'vue/no-deprecated-slot-attribute': 0,
    'vue/html-self-closing': 0,
    'vue/max-attributes-per-line': 0,
    'vue/html-closing-bracket-newline': 0,
    'no-magic-numbers': [2, { ignore: [-1, 0, 1] }],
    'prefer-const': 1,
    'no-undef': 1,
    '@typescript-eslint/no-unused-vars': 2,
    'no-dupe-keys': 2,
    'no-dupe-else-if': 2,
    'vue/component-definition-name-casing': [
      1,
      'kebab-case',
    ],
    'no-console':
      process.env.NODE_ENV === 'production' ? 1 : 0,
    'no-debugger':
      process.env.NODE_ENV === 'production' ? 1 : 0,
    '@typescript-eslint/ban-types': [
      'error',
      {
        types: {
          String: false,
          Boolean: false,
          Number: false,
          Symbol: false,
          '{}': false,
          Object: false,
          object: false,
          Function: false,
        },
        extendDefaults: true,
      },
    ],
    // Eslint Vue plugin
    'vue/no-unused-components': 2,
    'vue/multi-word-component-names': 0,
    'vue/attributes-order': 1,
    'vue/require-default-prop': 1,
    'vue/require-prop-types': 1,
    'vue/require-prop-type-constructor': 2,
    'vue/this-in-template': 1,
    'vue/valid-template-root': 2,
    'vue/require-render-return': 2,
    'vue/no-mutating-props': 2,
    'vue/no-useless-template-attributes': 1,
    'vue/no-v-model-argument': 0
  },
};
  
