# profbettingtips
Daily football predictions, free match insights, paid premium odds.

## Prediction Lab (experimental, no backend)

`/lab.html` (noindex, not linked from the main nav) shows model predictions for SportPesa-listed matches and
jackpots, graded against real results. There is **no database and no Supabase**: a GitHub Action runs the
agent every 6 hours, writes JSON to `data/`, commits it, and Vercel redeploys the static site.

```
GitHub Action (agent.yml, every 6h)
  1. agent/scrape-sportpesa.mjs   real browser -> SportPesa football list + Mega Jackpot Pro  -> data/sportpesa.json
  2. agent/run.mjs
       sources   football-data.co.uk (results + bookmaker odds, 38 leagues, incl. lower divisions)
                 football-data.org   (optional API key, fresher results)
                 ClubElo             (global club ratings)
                 Google News RSS     (injury / suspension / return headlines per team)
       settle    grade frozen predictions against real results
       learn     re-tune parameters on all history (walk-forward log-loss), every 30 new results
       predict   SportPesa-listed games first, then other fixtures; 1X2, double chance, O/U 2.5, BTTS
       publish   data/*.json -> commit -> Vercel redeploys -> lab.html reads the JSON
```

Every prediction stores two versions, the plain model and the full one (odds + ClubElo + news), so the
**Accuracy tab shows whether the extra data actually helps** on the same games. It also lists each source's health
and any team names it could not match.

### One-time setup
1. Merge this branch to `main` (scheduled workflows only run from the default branch).
2. Actions -> "Prediction agent" -> Run workflow, tick **backfill** (trains on 3 seasons; a few minutes).
3. Optional: add a `FOOTBALL_DATA_API_KEY` secret (free at football-data.org) for fresher results.

### SportPesa scraping
SportPesa renders its pages in the browser, so the scraper drives a real Chromium, records the JSON the page loads
and the visible text, and extracts "Team A vs Team B" fixtures. **It has not been run against the live site yet.**
If a run finds nothing, open the workflow run -> Artifacts -> `scrape-debug` to see exactly what the page returned
(HTTP status, JSON endpoints, page text), then adjust the URLs in `data/config.json` or the parser in
`agent/lib/sources/sportpesa.mjs`. Known risks: SportPesa may block datacenter IPs (the scraper reports "blocked" and
keeps the last good list; it does not try to bypass challenges), and its terms may restrict automated access. You can
also run `node agent/scrape-sportpesa.mjs` on your own computer (Kenyan IP) and commit `data/sportpesa.json`, or paste a
jackpot by hand into `data/jackpots/inbox.txt`:

```
# Mega Jackpot Pro | closes 2026-10-24 18:00 | prize KES 300,000,000
1. Arsenal vs Chelsea
2. Man City - Liverpool | 2-1      (optional result if the feed can't settle it)
```

### Coverage
Results/odds come from football-data.co.uk (England 1-5, Scotland 1-4, Germany, Italy, Spain, France, Netherlands,
Belgium, Portugal, Turkey, Greece + Argentina, Austria, Brazil, China, Denmark, Finland, Ireland, Japan, Mexico, Norway,
Poland, Romania, Russia, Sweden, Switzerland, USA). SportPesa games outside these (e.g. Kenyan Premier League) are
skipped and listed under Accuracy -> Data sources. Spelling differences are fixed in `data/aliases.json`,
e.g. `{"man utd": "manchester united"}`.

### Testing
- `node --test agent/test/jackpot.test.mjs agent/test/sources.test.mjs` parsers (CSV, odds, ClubElo, RSS, SportPesa shapes), name matching, jackpot settlement
- `node agent/test/simulate.mjs` 300-day synthetic world with a fake clock; checks learning, calibration, name merging, and that no prediction is ever edited after kickoff

### Going public
Remove `<meta name="robots" content="noindex">` from `lab.html` and add a nav link once the Accuracy tab has a few hundred graded games.
