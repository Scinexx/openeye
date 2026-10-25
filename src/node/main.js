// Run OpenEye locally without Cloudflare: website plus collector, with a SQLite file.
//   npm run local            website and collector
//   npm run local -- --web   website only
//   npm run collect          one collection pass, then exit
// Settings come from OPENEYE_* environment variables (see src/core/settings.js),
// plus OPENEYE_PORT, OPENEYE_HOST and OPENEYE_DB.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`OpenEye needs Node.js 22.13 or newer (you have ${process.versions.node}).`);
  process.exit(1);
}
const {join} = await import('node:path');
const {loadSettings} = await import('../core/settings.js');
const {ensureSchema} = await import('../core/schema.js');
const {Collector} = await import('../core/collector.js');
const {SqliteD1} = await import('./sqlite-d1.js');
const {startServer, ROOT} = await import('./server.js');

const stamp = () => new Date().toLocaleTimeString();
const log = {
  info: (...a) => console.log(`[${stamp()}]`, ...a),
  warn: (...a) => console.warn(`[${stamp()}] warning:`, ...a),
  error: (...a) => console.error(`[${stamp()}] error:`, ...a)
};

const env = process.env;
const settings = loadSettings(env, 'OPENEYE_');
const db = new SqliteD1(env.OPENEYE_DB ?? join(ROOT, 'data/openeye.db'));
await ensureSchema(db);
const mode = process.argv[2];

if (mode === '--collect') {
  log.info(`Collecting from ${settings.apiBase} ...`);
  await new Collector(db, settings, log).tick(true);
  log.info('Done.');
  db.close();
} else {
  let timer = null;
  if (mode !== '--web') {
    const collector = new Collector(db, settings, log);
    collector.tick().catch(e => log.error(e));
    timer = setInterval(() => collector.tick().catch(e => log.error(e)), 30_000);
    log.info(`Collector polling ${settings.apiBase}`);
  }
  const server = startServer(db, settings, {
    port: Number(env.OPENEYE_PORT ?? 3000), host: env.OPENEYE_HOST ?? '127.0.0.1', log
  });
  const shutdown = () => { clearInterval(timer); server.close(); db.close(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
