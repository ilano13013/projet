// Vérification statique sans dépendance : extrait le JS inline de
// prima/index.html et contrôle la syntaxe avec `node --check`.
// Usage : node tests/static-check.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const htmlPath = path.resolve(__dirname, '..', 'prima', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const tmp = path.join(os.tmpdir(), 'prima_check_' + Date.now() + '.js');
fs.writeFileSync(tmp, scripts);
try {
  execSync('node --check ' + JSON.stringify(tmp), { stdio: 'inherit' });
  console.log('STATIC OK ·', scripts.length, 'caractères de JS inline vérifiés');
} catch (e) {
  console.error('STATIC FAIL · erreur de syntaxe JS');
  process.exit(1);
} finally {
  try { fs.unlinkSync(tmp); } catch (e) {}
}
