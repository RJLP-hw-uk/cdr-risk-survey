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
branch `survey-review-results`, commit bb09785 (from `survey-v10-copy-and-simulation`): `survey/v11_preview/template.html`,
`v11_text.json`, `v11_overrides.json`, built with `python code/survey_sim/build_preview.py`. The design,
the simulation comparing the formats and the expert reviews are in the same repository
(`survey/METHODOLOGY.md`, `results/survey_sim/formats/`, `survey/reviews/`).

## Results preview after Submit

The thank-you screen shows what the results will look like, from AI respondents only (Claude Opus,
fresh session per answer, 4 roles × 3 expertise classes; run v10opus_2026-11-02 and its AHP repeat
v10ahpopus_2026-11-02, the settings chosen on the published-rate benchmark). For the
reviewer's technology (selectable): the discount-rate build-up for each answer method (rating scale;
AHP on the Saaty scale; the same AHP answers on the balanced scale) with the similar-industry WACC,
the change with the co-product or co-host split by risk, each risk's share of the baseline risk, and
how far the methods agree. `results_preview.json` holds aggregates only (means and quartiles), written
by `code/agents/elicitation/v10/export_review.py` on branch `v10-ai-calibration` of the same repository.
The premium caps are not yet calibrated, so the rate levels are illustrative.
