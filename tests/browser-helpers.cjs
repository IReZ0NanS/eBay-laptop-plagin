// Shared setup for the Playwright browser checks.
const fs = require('node:fs');
const path = require('node:path');

// Content scripts in the order Chrome injects them on eBay pages.
function contentScripts(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  return manifest.content_scripts.find(entry => entry.js.includes('content.js')).js;
}

function launchOptions() {
  return { headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) };
}

module.exports = { contentScripts, launchOptions };
