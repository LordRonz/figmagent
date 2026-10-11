# Figmagent LinkedIn launch content

Prepared 13 September 2026. Draft only; nothing has been posted to LinkedIn.

## Recommended post

I’ve been building Figmagent, a small Figma plugin for handing designs to AI coding tools.

Select a frame, click “Copy for AI,” and paste the context into your coding assistant.

The handoff includes layout, typography, colors, variables, component details, and references to companion assets. It uses FIGM/1, a compact text format that expresses design structure and omits defaults and redundant bookkeeping.

I wanted to measure how much smaller that handoff actually is.

In the current synthetic benchmark, the complete “Copy for AI” text used **40.1% fewer tokens than minified JSON**, measured as the median reduction across three sizes.

For the largest case: **12,082 → 7,051 tokens**.

A few other things I like about it:

• No extra account, API key, or backend setup.
• The plugin makes no network requests. You decide what to share with your AI tool.
• Download a handoff ZIP with the design context and companion assets.
• Keep readable JSON available when you want to inspect the full context model.

Version 2 is live, with a cleaner interface and better loading feedback.

The benchmark uses one synthetic fixture repeated at three scales, with the o200k_base tokenizer. It measures text size; real designs will vary.

If you use AI to implement Figma designs, I’d love to hear what information gets lost in your handoff.

https://www.figma.com/community/plugin/1674330715933853429

#Figma #DesignEngineering #BuildInPublic

## Optional first comment: benchmark details

A bit more detail on the numbers: I compared representations of the same canonical design-context model using o200k_base. The headline includes the short instruction text added by “Copy for AI.” Companion image/SVG contents and the rest of an AI conversation are excluded.

Raw FIGM/1 alone saved a median 41.0% versus minified JSON and 67.0% versus formatted JSON. The complete clipboard output saved 40.1% and 66.5%, respectively.

The test repeats one payment-card fixture 1, 5, and 20 times. It’s an initial format-size benchmark, not a broad sample of production Figma files or an evaluation of generated-code quality.

## Measured results

| Fixture scale | Nodes | Formatted JSON | Minified JSON | Raw FIGM/1 | Copy for AI, including instructions | Copy for AI reduction vs. minified JSON |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 copy | 4 | 1,544 | 872 | 542 | 572 | 34.4% |
| 5 copies | 20 | 5,772 | 3,232 | 1,906 | 1,936 | 40.1% |
| 20 copies | 80 | 21,627 | 12,082 | 7,021 | 7,051 | 41.6% |

All counts are text tokens. Median is calculated from the three per-case percentage reductions, not from pooled totals. The “large” case is large only relative to this suite: it contains 80 synthetic nodes.

### How the comparison was made

- Existing benchmark: `rtk npm run benchmark` runs `benchmark/format.ts` against `test/fixture.ts`.
- Tokenizer: `gpt-tokenizer` 3.4.0, `o200k_base` encoding.
- Formatted JSON: `encode(serializeJson(context)).length`.
- Minified JSON: `encode(JSON.stringify(context)).length`.
- Raw FIGM/1: `encode(serializeFigm(context)).length`.
- Actual Copy for AI text: `encode(serializeForAi(context)).length`, measured separately on the same inputs. This adds 30 tokens in each of these three cases.
- Reduction: `100 × (1 − output tokens / comparison tokens)`.

Both JSON baselines are Figmagent’s own canonical context model, not a raw Figma REST response. FIGM/1 intentionally omits defaults and normalized bookkeeping; it is not a lossless JSON encoding. The existing benchmark asserts selected layout, text, component, asset, and warning signals remain present. It does not prove complete semantic equivalence.

The benchmark clones node IDs while sharing fixture definitions and asset descriptors. Treat it as a serializer scaling test, not three independent, fully relinked Figma exports. It also bypasses live extraction and its default hidden-layer filtering.

## Useful product comparisons

| Comparison | Defensible positioning |
| --- | --- |
| Versus describing a screenshot manually | FIGM/1 supplies explicit design properties such as dimensions, spacing, typography, and variable references; reference screenshots remain useful for visual appearance. |
| Versus formatted JSON | Smaller text representation; measured raw FIGM/1 median reduction is 67.0% in this fixture suite. |
| Versus minified JSON | Savings remain after whitespace removal; actual Copy for AI median reduction is 40.1%. |
| Versus sending only context text | The handoff ZIP can also carry reference screenshots, SVGs, and original raster assets. |
| For iterative handoff | Copy changes compares against the last successful full handoff or AI copy within the same scope. Changed companion assets require a new handoff; larger deltas fall back to full context. |

## Claims to keep out of this post

- “40% cheaper AI coding” or “40% faster”: total cost and latency were not measured.
- “Better than Figma MCP,” Cursor, or another plugin: no direct comparative benchmark was run.
- “Pixel-perfect output” or “improves AI accuracy”: generated-code quality was not evaluated.
- “Lossless compression” or “keeps every property”: FIGM/1 deliberately omits some properties.
- “Tested on three real projects”: the current suite is one synthetic fixture at three scales.
- “Your design never leaves your device”: the plugin makes no network requests, but a user may subsequently send its output to an external AI service.

## Suggested attachment and demo

Attach `figmagent-token-benchmark.png` to the post. It uses the complete Copy for AI payload and includes the synthetic-data caveat inside the image.

For a later demo post, record 20–30 seconds using a design you can share publicly: select a frame, click Copy for AI, show the output preview, then show the handoff ZIP. Show an AI implementation only after actually generating and checking it.

Alternative opening: “How much design context can you remove before you start losing design intent? That’s the question behind Figmagent.” Use this as a framing question, not as a claim that the benchmark has measured the answer.
