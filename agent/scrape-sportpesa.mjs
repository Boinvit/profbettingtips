#!/usr/bin/env node
// Loads SportPesa pages in a real browser (they are JS-rendered) and writes data/sportpesa.json.
// Usage: node agent/scrape-sportpesa.mjs        (needs: npm i playwright && npx playwright install chromium)
// Runs from GitHub Actions; can also be run on your own computer (Kenyan IP) and the result committed.
// Be polite: one load per page per run, no login, no bet placement, no CAPTCHA bypass. SportPesa's terms may restrict
// automated access; this is for personal research. If the site shows a challenge page we stop and report it.
import fs from 'node:fs';
import path from 'node:path';
import { load, save, ROOT } from './lib/store.mjs';
import { bestFixtures } from './lib/sources/sportpesa.mjs';

const cfg = load('config.json', {}).sportpesa || {};
const JACKPOTS = cfg.jackpots || [{ name: 'SportPesa Mega Jackpot Pro', url: 'https://www.ke.sportpesa.com/en/mega-jackpot-pro' }];
const LISTS = cfg.lists || [{ name: 'Football', url: 'https://www.ke.sportpesa.com/en/sports-betting/football-1/' }];
const DEBUG = path.join(ROOT, 'debug'); fs.mkdirSync(DEBUG, { recursive: true });

let chromium;
try { ({ chromium } = await import('playwright')); } catch { console.error('playwright not installed'); process.exit(2); }

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ locale: 'en-KE', timezoneId: 'Africa/Nairobi', viewport: { width: 1366, height: 900 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' });

async function grab(name, url) {
  const page = await ctx.newPage(); const bodies = []; const seenUrls = [];
  page.on('response', async (res) => {
    try {
      if (!(res.headers()['content-type'] || '').includes('json')) return;
      const t = await res.text(); if (t.length > 3e6) return;
      bodies.push(JSON.parse(t)); seenUrls.push({ url: res.url().slice(0, 200), bytes: t.length });
    } catch {}
  });
  let status = 'ok', text = '';
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 2500); await page.waitForTimeout(700); } // lazy lists
    text = await page.evaluate(() => document.body.innerText);
    if (/just a moment|verify you are human|access denied|attention required/i.test(text.slice(0, 600))) status = 'blocked (bot challenge)';
  } catch (e) { status = 'error: ' + e.message.split('\n')[0]; }
  const found = status === 'ok' ? bestFixtures(bodies, text) : { matches: [] };
  fs.writeFileSync(path.join(DEBUG, `sportpesa-${name.replace(/\W+/g, '_')}.json`), JSON.stringify({ url, status, seenUrls, textHead: text.slice(0, 3000), found: found.matches.slice(0, 40) }, null, 1));
  await page.close();
  console.log(`${name}: ${status}, ${found.matches.length} matches via ${found.source || 'n/a'}`);
  return { status, ...found, head: text.replace(/\s+/g, ' ').slice(0, 400), seen: seenUrls.length };
}

const result = { scrapedAt: new Date().toISOString(), matches: [], jackpots: [], diagnostics: [] };
for (const j of JACKPOTS) {
  const r = await grab(j.name, j.url);
  result.diagnostics.push({ page: j.name, status: r.status, found: r.matches.length, seen: r.seen, head: r.head }); // head: first 400 chars of page text, to diagnose short/empty jackpot lists
  if (r.matches.length >= 8) result.jackpots.push({ name: j.name, closes: r.closes || null, prize: r.prize || '', games: r.matches.map((m) => ({ home: m.home, away: m.away })) });
}
for (const l of LISTS) {
  const r = await grab(l.name, l.url);
  result.diagnostics.push({ page: l.name, status: r.status, found: r.matches.length });
  result.matches.push(...r.matches);
}
await browser.close();
// keep the previous good file if this run found nothing (e.g. blocked), so the agent never loses its list
const prev = load('sportpesa.json', null);
if (!result.matches.length && !result.jackpots.length && prev) { prev.diagnostics = result.diagnostics; prev.lastAttempt = result.scrapedAt; save('sportpesa.json', prev, true); console.log('nothing found; kept previous data'); }
else save('sportpesa.json', result, true);
