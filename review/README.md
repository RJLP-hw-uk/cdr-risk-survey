# Review page: survey format comparison (draft v11)

`index.html` here is a review build for colleagues, published at
https://rjlp-hw-uk.github.io/cdr-risk-survey/review/. It is not the live survey (`../index.html`, v10),
sends nothing, and is marked `noindex`.

After the same front page, a second page lets the reviewer pick one of three answer formats, then take
that version of the draft v11 survey:

| Format | Risk questions | What the respondent does |
| --- | --- | --- |
| Sliders + rate (v11, proposed) | 14 | Rates each risk 0–10 for the baseline, then lower / same / higher for the version |
| Sliders + best–worst + rate | 28 | As v11, plus 7 sets of 3 risks: largest and smallest in each |
| AHP + rate | 42 | Compares the risks in 21 pairs (Saaty 1–9) for the baseline and again for the version |

All three ask the same project descriptions and discount-rate questions. The last page shows how the
answers split the risk premium, and "Review another format" restarts at the format page.

The file is generated; do not edit it here. Source: private repository `RJLP-hw-uk/cdr-cost-of-capital`,
branch `survey-v10-copy-and-simulation`, commit 7035246: `survey/v11_preview/template.html`,
`v11_text.json`, `v11_overrides.json`, built with `python code/survey_sim/build_preview.py`. The design,
the simulation comparing the formats and the expert reviews are in the same repository
(`survey/METHODOLOGY.md`, `results/survey_sim/formats/`, `survey/reviews/`).
