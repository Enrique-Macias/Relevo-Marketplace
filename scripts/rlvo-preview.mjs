// Static prototype packaging only. Never imports the app or reads environment files.
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, realpath, lstat, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SOURCE = 'design/rlvo-app.html';
const OUTPUT = path.join(ROOT, 'dist/rlvo-preview');
const ORIGIN = 'https://rlvo-preview.invalid';

// Keep quoted strings and newlines intact when removing non-rendered comments.
function stripComments(text, lineComments = false) {
  let result = '', quote = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      result += ch;
      if (ch === '\\' && i + 1 < text.length) result += text[++i];
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      result += ch;
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      assert(end >= 0, 'Comentario sin cierre');
      result += ' ' + text.slice(i, end + 2).replace(/[^\n]/g, '');
      i = end + 1;
    } else if (lineComments && ch === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i + 2);
      if (end < 0) break;
      result += '\n';
      i = end;
    } else result += ch;
  }
  return result;
}

function publishableHtml(source) {
  return source.replace(/<(style|script)\b([^>]*)>([\s\S]*?)<\/\1>/gi,
    (_, tag, attrs, body) => `<${tag}${attrs}>${stripComments(body, tag.toLowerCase() === 'script')}</${tag}>`)
    .replace(/<!--[\s\S]*?-->/g, '');
}

function references(html) {
  return [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map(m => m[1])
    .concat([...html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)].map(m => m[1].trim()));
}

function localPath(reference, page) {
  if (reference.startsWith('#')) return null;
  const url = new URL(reference.replaceAll('&amp;', '&'), `${ORIGIN}/${page}`);
  if (url.origin !== ORIGIN) {
    assert(url.protocol === 'https:' && ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname),
      `Recurso externo no autorizado: ${url.origin}`);
    return null;
  }
  return decodeURIComponent(url.pathname).slice(1);
}

async function readSource(file) {
  const absolute = path.join(ROOT, file);
  assert((await realpath(absolute)) === absolute, `No se permiten enlaces simbólicos: ${file}`);
  return readFile(absolute);
}

async function packageContents() {
  const source = (await readSource(SOURCE)).toString('utf8');
  const html = publishableHtml(source);
  assert(!/\bsupabase\b|\bEXPO_PUBLIC_[A-Z_]+|sb_(?:secret|publishable)_|process\.env/i.test(html),
    'El HTML publicable contiene referencias de infraestructura o credenciales');
  const files = new Map([[SOURCE, Buffer.from(html)]]);
  for (const reference of references(html)) {
    const file = localPath(reference, SOURCE);
    if (!file) continue;
    // Copy only explicitly referenced official SVGs, never entire repo directories.
    assert(/^assets\/brand\/\d{2}_[a-z_]+\.svg$/.test(file),
      `Dependencia local no autorizada: ${file}. Revisa su inclusión antes de ampliar el paquete.`);
    files.set(file, await readSource(file));
  }
  // Root serves the full prototype directly; nested HTML keeps its original relative paths.
  const index = html.replace(/\b(src|href)\s*=\s*(["'])([^"']+)\2/gi, (attribute, name, quote, ref) => {
    const file = localPath(ref, SOURCE);
    if (!file) return attribute;
    const url = new URL(ref, `${ORIGIN}/${SOURCE}`);
    return `${name}=${quote}./${file}${url.search}${url.hash}${quote}`;
  });
  files.set('index.html', Buffer.from(index));
  // A real 404 avoids Pages' default SPA fallback hiding missing assets.
  files.set('404.html', Buffer.from('<!doctype html>\n<html lang="es"><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>RLVO — Página no encontrada</title><h1>Página no encontrada</h1><a href="/">Volver al prototipo RLVO</a></html>\n'));
  files.set('_headers', Buffer.from('/*\n  X-Robots-Tag: noindex, nofollow\n'));
  return { files, source };
}

async function assertOutputPath() {
  for (const dir of [path.dirname(OUTPUT), OUTPUT]) {
    try {
      const stat = await lstat(dir);
      assert(stat.isDirectory() && !stat.isSymbolicLink(), `Directorio de salida inválido: ${dir}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

async function build() {
  const { files } = await packageContents();
  await assertOutputPath();
  // Only the disposable preview directory is regenerated; other dist outputs are untouched.
  await rm(OUTPUT, { recursive: true, force: true });
  for (const [file, content] of files) {
    const destination = path.join(OUTPUT, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
  console.log(`Generado dist/rlvo-preview/ (${files.size} archivos).`);
  console.log('Fuentes externas: Google Fonts, igual que en el prototipo fuente.');
}

async function listFiles(dir, prefix = '') {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), `Enlace simbólico no permitido en salida: ${entry.name}`);
    const file = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path.join(dir, entry.name), file));
    else { assert(entry.isFile()); files.push(file); }
  }
  return files.sort();
}

function checkInteractions(html) {
  const categories = [...html.matchAll(/class="phone-block(?: [^"]+)?" data-cat="([^"]+)"/g)].map(m => m[1]);
  const blocks = categories.map(cat => ({ style: {}, getAttribute: () => cat }));
  const events = () => ({ handlers: {}, addEventListener(event, fn) { this.handlers[event] = fn; } });
  const classList = () => ({ values: new Set(), add(v) { this.values.add(v); }, remove(v) { this.values.delete(v); }, toggle(v, on) { if (on) this.add(v); else this.remove(v); } });
  const chips = ['all', ...new Set(categories)].map(cat => ({ ...events(), classList: classList(), getAttribute: () => cat }));
  const ids = Object.fromEntries(['filter-count', 'c-primary', 'c-secondary', 'c-bg', 'c-surface', 'c-text', 'f-display', 'f-body', 'reset-style'].map(id => [id, events()]));
  const variables = new Map();
  const dots = Array.from({ length: 4 }, () => ({ classList: classList() }));
  const track = { ...events(), clientWidth: 355, scrollLeft: 0, parentElement: { querySelectorAll: () => dots }, getAttribute: () => '2' };
  const document = {
    documentElement: { style: { setProperty: (key, value) => variables.set(key, value) } },
    getElementById: id => ids[id],
    querySelectorAll: selector => ({ '.phone-block': blocks, '.filter-chip': chips, '.detail-track, .viewer-track': [track] })[selector],
  };
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  assert.equal(scripts.length, 1, 'Se esperaba el JavaScript integrado del prototipo');
  new vm.Script(scripts[0]).runInNewContext({ document }, { timeout: 1000 });
  assert.equal(ids['filter-count'].textContent, `${blocks.length} de ${blocks.length} pantallas`);
  for (const chip of chips) {
    chip.handlers.click();
    const cat = chip.getAttribute();
    const expected = cat === 'all' ? categories.length : categories.filter(c => c === cat).length;
    assert.equal(blocks.filter(b => b.style.display !== 'none').length, expected);
    assert.equal(ids['filter-count'].textContent, `${expected} de ${blocks.length} pantallas`);
  }
  ids['c-primary'].handlers.input({ target: { value: '#000000' } });
  assert.equal(variables.get('--brick'), '#000000');
  ids['f-display'].handlers.change({ target: { value: 'Sora' } });
  assert.equal(variables.get('--font-display'), "'Sora'");
  ids['reset-style'].handlers.click();
  assert.equal(variables.get('--brick'), '#b9ff66');
  assert.equal(ids['f-display'].value, 'Manrope');
  assert.equal(track.scrollLeft, 710);
  track.handlers.scroll();
  assert(dots[2].classList.values.has('active'));
  track.scrollLeft = 355;
  track.handlers.scroll();
  assert(dots[1].classList.values.has('active') && !dots[2].classList.values.has('active'));
  return categories.length;
}

async function checkHttp(files) {
  const server = createServer((req, res) => {
    const route = decodeURIComponent(new URL(req.url, ORIGIN).pathname);
    const file = route === '/' ? 'index.html' : route === '/design/rlvo-app' ? SOURCE : route.slice(1);
    const content = files.get(file);
    const type = file.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8';
    res.writeHead(content && file !== '_headers' ? 200 : 404, { 'Content-Type': type });
    res.end(content && file !== '_headers' ? content : files.get('404.html'));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const route of ['/', '/index.html', `/${SOURCE}`, '/design/rlvo-app']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200, route);
      const html = await response.text();
      assert(html.includes('RLVO — Prototipo de app móvil'));
      for (const ref of references(html)) {
        const file = localPath(ref, route === '/' ? 'index.html' : route.slice(1));
        if (!file) continue;
        const asset = await fetch(new URL(ref, base + route));
        assert.equal(asset.status, 200, ref);
        assert(asset.headers.get('content-type').startsWith('image/svg+xml'));
        assert(Buffer.from(await asset.arrayBuffer()).equals(files.get(file)), ref);
      }
    }
    for (const route of ['/.env', '/supabase/config.toml', '/src/app/_layout.tsx', '/design/admin-panel.html', '/design/RLVO_DESIGN_SYSTEM.md', '/assets/brand/no-existe.svg']) {
      assert.equal((await fetch(base + route)).status, 404, route);
    }
  } finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
}

async function check() {
  await assertOutputPath();
  const { files: expected, source } = await packageContents();
  assert.deepEqual(await listFiles(OUTPUT), [...expected.keys()].sort(), 'Archivos inesperados o faltantes en el paquete');
  const actual = new Map();
  for (const [file, content] of expected) {
    const buffer = await readFile(path.join(OUTPUT, file));
    assert(buffer.equals(content), `Archivo desactualizado o alterado: ${file}. Ejecuta build:rlvo-preview.`);
    actual.set(file, buffer);
  }
  const html = actual.get(SOURCE).toString('utf8');
  assert.equal((html.match(/class="phone-block(?: [^"]+)?"/g) || []).length,
    (source.match(/class="phone-block(?: [^"]+)?"/g) || []).length);
  const frames = checkInteractions(html);
  checkInteractions(actual.get('index.html').toString('utf8'));
  await checkHttp(actual);
  console.log(`Validado: ${frames} frames, filtros, editor, carrusel, logos idénticos y rutas HTTP.`);
  console.log('Paquete limitado al prototipo, SVGs referenciados, 404.html y _headers; sin archivos internos.');
}

try {
  if (process.argv[2] === 'build') await build();
  else if (process.argv[2] === 'check') await check();
  else throw new Error('Uso: node scripts/rlvo-preview.mjs build|check');
} catch (error) { console.error(`RLVO preview: ${error.message}`); process.exitCode = 1; }
