# Survey tests

Browser tests for `index.html` (Playwright, Chromium). Both scripts serve the page from a local http server, because with file:// URLs headless Chromium sometimes loses localStorage on reload. They do not send anything to the real Google Form: form requests are intercepted.

```bash
npm i -D playwright && npx playwright install chromium   # if the Chromium download fails, the tests use /usr/bin/google-chrome (or CHROME_PATH)
node tests/run.js      # click-through: consent page and privacy notice, technology list, 7 risk categories, baseline on one page of 7 coloured 0–10 sliders (Not set until touched, Not sure per risk, soft warning for unset sliders) plus one variant (co-product or co-host; random assignment when a technology has both, incl. skipping the variant) rated on one comparison page of 7 sliders (much lower … much higher than the baseline, Not set until touched); phone taps on both slider pages checked under Pixel 7 touch emulation; one importance question after the last part (for the technology in general), unset-slider warning placed above the first unset row, thank-you screen with interview offer, interview mode (#interview), Google Form payload, timing and contact row, email fallback, claude.ai editor/respondent storage (mocked); results figures on the thank-you screen (S9: rows, You dots, implied discount rate against the formula, experts hidden below min_n, no variant figure when skipped, nothing on 404 / malformed file / interview mode)
node tests/visual.js   # fixed layout: Back/Next never move, baseline sliders keep one width per window, the page itself never scrolls (6 window sizes)
```

`mock.js` stands in for the claude.ai runtime (database, user, downloads) so the same page can be tested as a claude.ai artifact.

`results.fixture.json` holds plausible aggregates for all 12 technologies (format `cdr-risk-results/1`; experts n = 6 only for dac_ss and biochar, AI n = 12 everywhere). `run.js` serves it in place of `results.json`, so the tests do not depend on the root `results.json`, which is a copy of the fixture (`"updated": "fixture"`) until real aggregates replace it.
