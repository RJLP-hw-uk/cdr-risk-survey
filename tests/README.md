# Survey tests

Browser tests for `index.html` (Playwright, Chromium). They do not send anything to the real Google Form: form requests are intercepted.

```bash
npm i -D playwright && npx playwright install chromium
node tests/run.js      # click-through: consent page and privacy notice, every button, navigation, both importance questions, thank-you screen with interview offer, interview mode (#interview), Google Form payload and contact row, email fallback, claude.ai editor/respondent storage (mocked)
node tests/visual.js   # fixed layout: Back/Next never move, grid squares stay one size per window, the page itself never scrolls (6 window sizes)
```

`mock.js` stands in for the claude.ai runtime (database, user, downloads) so the same page can be tested as a claude.ai artifact.
