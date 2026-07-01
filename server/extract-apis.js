const fs = require('fs');
const content = fs.readFileSync('index-D2yTSMbE.js', 'utf8');

// Extract all fetch API paths
const fetchMatches = content.matchAll(/fetch\(`[^`]*?\/api\/admin\/([a-zA-Z0-9_\-/]+)/g);
const paths = new Set();
for (const m of fetchMatches) {
  paths.add('/api/admin/' + m[1]);
}

console.log('=== Frontend Admin API Paths ===');
[...paths].sort().forEach(p => console.log(p));
