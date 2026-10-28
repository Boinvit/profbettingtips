#!/usr/bin/env python3
"""Run from the repo root:  python3 clean_dummy_data.py
Removes hardcoded dummy matches, drops the unused Supabase script tag, and fixes the
featured-match card so prediction, odds, time and initials come from data/recent.json.
Idempotent: safe to run twice. Reports every edit it applied or skipped."""
import re, glob, sys

def edit(path, fn):
    try:
        src = open(path, encoding='utf-8').read()
    except FileNotFoundError:
        print(f'SKIP  {path} (not found)'); return
    out, notes = fn(src)
    for n in notes: print(n.replace('{f}', path))
    if out != src:
        open(path, 'w', encoding='utf-8', newline='').write(out)

def sub(pattern, repl, text, label, flags=re.S):
    new, n = re.subn(pattern, repl, text, count=1, flags=flags)
    return new, (f'OK    {{f}}: {label}' if n else f'SKIP  {{f}}: {label} (pattern not found / already done)')

NONE_MSG = '<p class="text-muted" style="padding:20px;">No upcoming predictions yet. They appear after the agent\'s next run.</p>'

# 1) Supabase script tag, every page (site is static)
for p in glob.glob('*.html'):
    def f(s):
        out, n = sub(r'[ \t]*<script src="https://cdn\.jsdelivr\.net/npm/@supabase/supabase-js@2"></script>\n?', '', s, 'removed Supabase script')
        return out, [n]
    edit(p, f)

# 2) index.html dummy ticker / featured card / free tips
def index(s):
    notes = []
    s, n = sub(r'(<div class="ticker-content" id="ticker-content">).*?(</div>)',
               r'\1<span class="ticker-item">Predictions appear here after the next agent run</span>\2', s, 'ticker dummy matches'); notes.append(n)
    a = s.find('id="featured-home"'); b = s.find('<!-- ── Stats Strip')
    if a != -1 and b != -1 and 'Man City' in s[a:b]:
        blk = s[a:b]
        blk = re.sub(r'(id="featured-home-init">)[^<]*', r'\1–', blk)
        blk = re.sub(r'(id="featured-away-init">)[^<]*', r'\1–', blk)
        blk = re.sub(r'(featured-home-name">)[^<]*', r'\1TBA', blk)
        blk = re.sub(r'(featured-away-name">)[^<]*', r'\1TBA', blk)
        blk = re.sub(r'(<div class="value">)[^<]*', r'\1–', blk)
        blk = re.sub(r'(featured-pred-val">)[^<]*', r'\1–', blk)
        blk = re.sub(r'(featured-odds-val">)[^<]*', r'\1–', blk)
        blk = re.sub(r'<span class="featured-time">[^<]*</span>', '<span class="featured-time">⏰ –</span>', blk)
        blk = re.sub(r'<span>Premier League · Matchday 34</span>', '<span class="featured-meta">Next fixtures coming soon</span>', blk)
        s = s[:a] + blk + s[b:]; notes.append('OK    {f}: featured card dummy values')
    else: notes.append('SKIP  {f}: featured card (not found / already done)')
    s, n = sub(r'(<div class="tips-grid" id="free-tips-grid">).*?(</div>\s*</div>\s*</section>)',
               r'\1\n        ' + NONE_MSG + r'\n      \2', s, 'free tips dummy cards'); notes.append(n)
    return s, notes
edit('index.html', index)

# 3) daily.html dummy free + locked premium cards
def daily(s):
    notes = []
    s, n = sub(r'(<div class="tips-grid mb-32" id="free-tips-grid">).*?(\n    </div>\n\n    <div class="container">)',
               r'\1\n      ' + NONE_MSG + r'\2', s, 'free tips dummy cards'); notes.append(n)
    s, n = sub(r'(<div class="tips-grid" id="predictions-grid">).*?(\n    </div>\n\n    <!-- CTA Banner -->)',
               r'\1\2', s, 'locked premium dummy cards'); notes.append(n)
    return s, notes
edit('daily.html', daily)

# 4) js/app.js: featured card must update prediction, odds, time, initials, highlighted chip
OLD = "      el.querySelectorAll('.odd-chip .value').forEach((n, i) => { if (odds[i]) n.textContent = (+odds[i]).toFixed(2); });\n"
NEW = OLD + """      const ix = { H: 0, D: 1, A: 2 }[f.pk.x12];
      const ini = (t) => t.split(/\\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
      set('#featured-home-init', ini(f.home)); set('#featured-away-init', ini(f.away));
      set('.featured-pred-val', LAB_PICK[f.pk.x12]);
      if (odds[ix]) set('.featured-odds-val', (+odds[ix]).toFixed(2));
      set('.featured-time', '⏰ ' + eatTime(f.kickoff) + ' EAT');
      set('.featured-meta', LAB_COMP[f.comp] || '');
      el.querySelectorAll('.odd-chip').forEach((c, i) => c.classList.toggle('active', i === ix));
"""
def appjs(s):
    if "set('.featured-pred-val'" in s: return s, ['SKIP  {f}: featured card fix (already applied)']
    if OLD not in s: return s, ['FAIL  {f}: anchor line not found, edit manually']
    return s.replace(OLD, NEW, 1), ['OK    {f}: featured card now shows real prediction/odds/time']
edit('js/app.js', appjs)
