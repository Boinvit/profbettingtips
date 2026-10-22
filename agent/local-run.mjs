#!/usr/bin/env node
// Runs the whole agent on YOUR computer and publishes the result (use when GitHub Actions is unavailable, or to
// scrape SportPesa from a Kenyan IP). Needs: Node 20+, git with push access, and once: npm i playwright && npx playwright install chromium
// Usage:  node agent/local-run.mjs [--backfill]     Schedule it (cron / Windows Task Scheduler) every 6 hours.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts }); return r.status === 0; };
const out = (cmd, args) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8' }).stdout.trim();

run('git', ['pull', '--rebase', '--autostash', 'origin', 'main']);
if (!run('node', ['agent/scrape-sportpesa.mjs'])) console.log('SportPesa scrape failed or skipped; continuing with other sources.');
if (!run('node', ['agent/run.mjs', ...process.argv.slice(2).filter((a) => a === '--backfill')])) { console.error('Agent failed.'); process.exit(1); }
run('git', ['add', 'data']);
if (!out('git', ['diff', '--cached', '--name-only'])) { console.log('No data changes.'); process.exit(0); }
run('git', ['commit', '-m', `data: local agent update ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`]);
if (!run('git', ['push', 'origin', 'HEAD:main'])) { run('git', ['pull', '--rebase', 'origin', 'main']); run('git', ['push', 'origin', 'HEAD:main']); }
console.log('Published. Vercel will redeploy in about a minute.');
