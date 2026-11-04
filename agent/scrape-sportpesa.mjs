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
  let status = 'ok', text = '', ui = [], clicked = [];
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 2500); await page.waitForTimeout(700); } // lazy lists
    text = await page.evaluate(() => document.body.innerText);
    try { // best effort: record the page's tabs, then click day filters (Tomorrow, weekdays) so later days load into the captured JSON
      ui = await page.evaluate(() => [...new Set([...document.querySelectorAll('button,a,[role=tab],li,span')].map((e) => (e.innerText || '').trim().replace(/\s+/g, ' ')).filter((t) => t && t.length < 22))].slice(0, 90));
      try { await page.getByText(/^accept$/i).first().click({ timeout: 2000 }); await page.waitForTimeout(600); clicked.push('cookies accepted'); } catch {} // the cookie banner can swallow clicks
      for (const re of [/^upcoming$/i, /^tomorrow$/i, /^next 24 hours$/i, /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*[ ,]*[0-9]{0,2}$/i]) {
        let els = []; try { els = await page.getByText(re).all(); } catch {}
        clicked.push(String(re).slice(0, 18) + ' x' + els.length);
        for (const el of els.slice(0, 8)) {
          try {
            const label = (await el.innerText({ timeout: 800 })).trim().slice(0, 20);
            await el.click({ timeout: 2500, force: true }); clicked.push(label); await page.waitForTimeout(900);
            for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 2500); await page.waitForTimeout(600); }
          } catch (e) { clicked.push('ERR ' + String(e.message).split(String.fromCharCode(10))[0].slice(0, 90)); }
        }
      }
      const after = await page.evaluate(() => [...new Set([...document.querySelectorAll('button,a,[role=tab],li,span')].map((e) => (e.innerText || '').trim().replace(/\s+/g, ' ')).filter((t) => t && t.length < 22))].slice(0, 120));
      ui = [...ui.slice(0, 20), '=== after clicks ===', ...after.slice(45, 110)];
      text = await page.evaluate(() => document.body.innerText);
    } catch {}
    if (/just a moment|verify you are human|access denied|attention required/i.test(text.slice(0, 600))) status = 'blocked (bot challenge)';
  } catch (e) { status = 'error: ' + e.message.split('\n')[0]; }
  const found = status === 'ok' ? bestFixtures(bodies, text) : { matches: [] };
  fs.writeFileSync(path.join(DEBUG, `sportpesa-${name.replace(/\W+/g, '_')}.json`), JSON.stringify({ url, status, seenUrls, textHead: text.slice(0, 3000), found: found.matches.slice(0, 40) }, null, 1));
  await page.close();
  console.log(`${name}: ${status}, ${found.matches.length} matches via ${found.source || 'n/a'}`);
  return { status, ...found, head: text.replace(/\s+/g, ' ').slice(0, 400), seen: seenUrls.length, ui, clicked, apis: seenUrls.filter((u) => !u.url.includes('/i18n/')).slice(0, 14).map((u) => u.bytes + ' ' + u.url.slice(0, 150)) };
}

const result = { scrapedAt: new Date().toISOString(), matches: [], jackpots: [], diagnostics: [] };
for (const j of JACKPOTS) {
  const r = await grab(j.name, j.url);
  result.diagnostics.push({ page: j.name, status: r.status, found: r.matches.length, seen: r.seen, head: r.head }); // head: first 400 chars of page text, to diagnose short/empty jackpot lists
  if (r.matches.length >= 8) result.jackpots.push({ name: j.name, closes: r.closes || null, prize: r.prize || '', games: r.matches.map((m) => ({ home: m.home, away: m.away })) });
}
for (const l of LISTS) {
  const r = await grab(l.name, l.url);
  result.diagnostics.push({ page: l.name, status: r.status, found: r.matches.length, days: r.matches.reduce((a, m) => { const k = (m.kickoff || 'none').slice(0, 10); a[k] = (a[k] || 0) + 1; return a; }, {}), clicked: r.clicked, ui: r.ui, apis: r.apis });
  result.matches.push(...r.matches);
}
await browser.close();
// keep the previous good file if this run found nothing (e.g. blocked), so the agent never loses its list
const prev = load('sportpesa.json', null);
if (!result.matches.length && !result.jackpots.length && prev) { prev.diagnostics = result.diagnostics; prev.lastAttempt = result.scrapedAt; save('sportpesa.json', prev, true); console.log('nothing found; kept previous data'); }
else save('sportpesa.json', result, true);
