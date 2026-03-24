module.exports = {
  testDir: './tests',
  timeout: 30000,
  use: { headless: true, screenshot: 'only-on-failure' },
  reporter: 'list'
};
