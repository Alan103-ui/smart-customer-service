module.exports = {
  testEnvironment: 'node',
  testTimeout: 30000,
  maxWorkers: 2,
  collectCoverageFrom: [
    '*.js',
    '!node_modules/**',
    '!coverage/**',
    '!*.test.js'
  ],
  coverageReporters: ['text', 'lcov', 'html'],
  coverageDirectory: 'coverage',
  verbose: true
};
