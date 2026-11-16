# T-001 research: DWG upload

**Question.** How does a static site (plain ES modules) + Vercel functions (60 s, 4.5 MB body) turn a designer's `.dwg`
into what `src/editor/dxf.js` (`decodeDXF` → `parseDXF` → `wallsFromDXF`) already handles?
**Decision it feeds.** Which converter the import-engineer builds for T-001, and whether the owner has to pay for or sign up to anything.
Researched 2026-11-16. USD→NT$ at 32.89 ([currency.me.uk, 13 Nov 2026](https://www.currency.me.uk/convert/usd/twd?amount=1)).

## Options

| | A. **acad-ts in the browser** | B. LibreDWG → WebAssembly | C. ODA | D. Autodesk APS (Design Automation) | E. CloudConvert API |
|---|---|---|---|---|---|
| What | MIT TypeScript port of ACadSharp. Reads DWG AC1009–AC1032 and writes ASCII DXF. | `@mlightcad/libredwg-web` 0.9.0, a GNU LibreDWG build with `dwg_write_dxf` | Drawings SDK (C++). The free ODA File Converter is the other route. | Runs real AutoCAD in Autodesk's cloud: `DXFOUT` script | Hosted converter. Its DWG→DXF page confirms support. |
| Runs | Browser (Web Worker), no server | Browser, or in a Vercel function | A container (not Vercel serverless) | Autodesk cloud, called from `api/dwg.js` | CloudConvert, called from `api/dwg.js` |
| Size / speed | 1.2 MB minified ESM, 254 KB gzip. 10–150 ms per test file; 40k lines in about 4 s | 7.8 MB wasm (2.0 MB gzip). 30–460 ms per file; 40k lines in 3 s | n/a | Queue, upload and work item: tens of seconds (*unverified*) | Upload and convert: seconds (*unverified*) |
| Cost per file | **NT$0** (the designer's CPU) | NT$0 (or Vercel CPU time) | Membership **US$3,000 the first year, then US$2,250 a year** ("limited commercial use"), or US$7,500, then US$4,500 for unlimited | **At least US$0.10 (NT$3.3)** per file: 2 tokens per processing hour at the old rate, US$3 per token, a 100-token minimum buy (US$300). Rates rose from 2025-12-08 (new rate *unverified*). | 1 credit per conversion-minute. About US$0.01–0.02 (NT$0.3–0.7) per file; packages listed from US$8 (*Capterra; vendor prices not rendered*) |
| 200 files a month | NT$0 | NT$0 | NT$6,200+ a month (amortised) | NT$660+ a month, plus an NT$9,870 token pre-buy | about NT$66–130 a month |
| Privacy | **The file never leaves the browser** | Browser: same as A. Server: goes to our Supabase Storage only | Ours | The file goes to Autodesk storage | The file goes to CloudConvert. Its policy says files are "deleted immediately afterwards"; ISO 27001; German company |
| Licence risk | None (MIT) | **GPL-3.0.** In the browser we would be *conveying* it to every visitor, and the editor JS could count as a combined work. On a server it is not conveying (GPLv3 §0), so that is fine. | The free Converter's licence bars "timesharing or service bureau" use and use by the user's employer, so it is not allowed for us | Autodesk terms | Their terms |
| Account / keys | none | none | ODA membership | APS app + Flex tokens + keys | CloudConvert account + API key |

**Ruled out early.**
- ConvertAPI: its AutoCAD converters list DWG→PDF/SVG/PNG/JPG, with no DWG→DXF.
- Aspose.CAD Cloud: it does DWG→DXF over REST with 150 free calls a month, but its prices are not public. *Unverified; not pursued.*

**How each option plugs in.**
- **A:** add `vendor/acad-ts/acad-ts.min.js`, a copy of the package's `dist/index-min.js` at a pinned version. It is self-contained, with no `require`, `node:` or `Buffer`, so it is vendored and no build step is needed.
  - New module `src/editor/dwg.js` exports `dwgToDXF(arrayBuffer) → string`. It wraps `DwgReader.readFromStream` and `DxfWriter.writeToStream` and is pure, so `qa/` can import it.
  - New worker `src/editor/dwg-worker.js` runs it off the main thread, loaded lazily only when a `.dwg` arrives.
  - `src/editor/editor.js`: `importDXF` (line 1277) swaps the "save as DXF" toast for `await dwgToDXF(src)`, then the existing path runs. The drop handler at line 1350 already routes `.dwg` there.
  - `projects.html` already accepts `.dwg` (line 113) and hands it over through `src/handoff.js`. The progress screen gains a 轉檔 step.
- **B (server):** new `api/dwg.js` (CommonJS, wasm in Node). The browser has to upload to a private Supabase bucket first because of the 4.5 MB request limit, and DXF output is 2–5× the DWG, so it has to come back through storage too.
- **D / E:** new `api/dwg.js` holds the key and creates a signed upload. The browser uploads directly, and the function polls and returns the DXF.

## Evidence (tested 2026-11-16)

**Method.** I took 12 public DWGs: LibreDWG `test/test-data/example_{2000..2018}.dwg` and ACadSharp `samples/sample_AC10{15..32}.dwg`. Each went DWG → converter → our `parseDXF` → `wallsFromDXF`. I compared the results against the AutoCAD-made DXFs of the same drawings. Scripts are in the session scratchpad and are about 20 lines each.

| File set (versions) | AutoCAD DXF: segs / texts / walls | A. acad-ts 3.7.0 | B. libredwg-web 0.9.0 |
|---|---|---|---|
| LibreDWG example, R2000–R2018 (AC1015–AC1032) | 386 / 5 / 38 | 386 / 5 / 38 on all 6 versions | 386 / 5 / 38 on all 6 versions |
| ACadSharp sample, R2000–R2018 | 529 / 38 / 26 | 529 / 38 (37 on AC1032) / 25 | 529 / 38 / 25 |

- **Both converters read every version from R2000 to R2018.** The R2018 format (AC1032) is the one AutoCAD 2018–2025 saves, and R2013 is AC1027. The wall count is within 4% of AutoCAD's own DXF, and both converters give the same count, so the gap comes from our wall detection, not the converter.
- **Chinese text, R2018.** I generated a DWG with layer `A-牆面` and text `主臥室`. Both readers return it intact, in Node and in headless Chrome. The Chrome run loads acad-ts as a plain `<script type="module">` with no build step.
- **Big5 in R2004-and-older DWGs:** *not verified.* acad-ts decodes `ANSI_950` through `TextDecoder('big5')` (I read `IO/TextEncoding.js`), but I could not make a test file. A real fixture is needed.
- **Speed.** A synthetic DWG with 40,000 lines and 2,000 texts converted in Node as follows:
  - acad-ts: read 2.0 s, then DXF write 1.9 s.
  - LibreDWG: 3.1 s.
  - After either one, our `parseDXF` takes 3.0 s.
  - Real 5–30 MB plans carry hatches, blocks and images; how long they take is *unverified* until the fixtures arrive.
- **Package versions (npm, 2026-11-16).**
  - `@node-projects/acad-ts`: MIT. First published 2026-04-13; 20 releases; 6 maintainers; 3.7.0 is from 2026-10-30.
  - `@mlightcad/libredwg-web`: GPL-3.0; 0.9.0 is from 2026-11-15.
- **Sources.**
  - LibreDWG manual: reads "r1.2 to r2018 for 99%"; licence GPLv3+.
  - [GPLv3 §0](https://www.gnu.org/licenses/gpl-3.0.en.html): "Mere interaction with a user through a computer network, with no transfer of a copy, is not conveying."
  - [ODA pricing](https://www.opendesign.com/pricing.md) and [ODA Community User Agreement 09-2025 §3.1.1](https://www.opendesign.com/agreements/2025/en/ODA%20Community%20User%20Agreement%2009-2025.pdf)
  - APS: [Sept 2025 pricing change](https://aps.autodesk.com/node/3776) (effective 2025-12-08; minimum 100 tokens, expiring in 12 months) and [older rates](https://aps.autodesk.com/node/3636) (Design Automation 2 tokens per processing hour; Model Derivative 0.1–0.5 tokens per job)
  - [Flex rate sheet](https://www.autodesk.com/benefits/flex/flex-rate-sheet): US$3 per token
  - CloudConvert: [pricing](https://cloudconvert.com/pricing) (1 credit per minute; free 10 credits a day), [DWG→DXF](https://cloudconvert.com/dwg-to-dxf) and [security](https://cloudconvert.com/security)
  - [ConvertAPI AutoCAD converters](https://www.convertapi.com/api/tag/autocad)
  - [Vercel 4.5 MB body limit](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)
  - [ACadSharp](https://github.com/DomCR/ACadSharp) (MIT)
- **Known gaps for every open-source reader.** Custom objects from vertical apps, such as 天正 TArch walls, and proxy entities are not drawn. Taiwan firms mostly use plain AutoCAD; drawings made with GstarCAD or ZWCAD are untested.

## Recommendation: A, acad-ts in the browser

**Why A.**
- It costs nothing and needs no accounts.
- The client's drawing never leaves the designer's machine, which meets the "no third-party storage" criterion outright.
- It is MIT-licensed, so there is no GPL question.
- It is 254 KB gzip against 2 MB for LibreDWG.
- In the tests it matched both LibreDWG and AutoCAD's own DXF on R2000–R2018.

**Fallback.** If a real fixture fails in acad-ts, try LibreDWG in a Vercel function (option B on the server). That is also free and avoids the GPL issue; it needs a private Supabase bucket. Keep CloudConvert (about NT$130 a month) as a paid fallback for the owner to approve only if both fail.

**Cost:** NT$0 per conversion. Vercel serves the 1.2 MB file once per browser; the cache is immutable under `/vendor/`.

**Builder notes.**
- Pin acad-ts **3.7.0**, which is at least two weeks old.
- Save `vendor/acad-ts/LICENSE`.
- Use the existing toast rather than the R2010 hint when a file fails.
- Cap input at 50 MB.

**Owner must:**
1. Put **2 or more real DWG plans** in `FATTY-BAMBA/spatial-lab-fixtures`, each with the **same drawing exported to DXF from AutoCAD**:
   - one saved in AutoCAD 2018+ format with Chinese layer names and text;
   - ideally one old (2004-format) file with Big5 text.
2. Nothing to sign up for or pay.

**Acceptance tests (builder):**
1. `qa/unit/dwg.test.mjs`: in the test, generate DWGs with acad-ts `DwgWriter` in AC1015, AC1018, AC1024, AC1027 and AC1032, containing lines on layer `A-牆面` and text `主臥室`. Run `dwgToDXF` → `parseDXF` and check segment count, layer names and text. No binary file is committed, which suits the public repo.
2. Same file: a truncated or garbage `.dwg` makes `dwgToDXF` throw a typed error; a file over 50 MB is rejected before parsing.
3. Regression: the DWG/DXF fixture pairs from the owner, `client-0x.dwg` and `client-0x.dxf`, go through `qa/regress.mjs`. Walls, rooms and room area must be within 10% between the two halves of each pair. The report records conversion time.
4. e2e:
   - Drop a `.dwg` on 我的專案: progress shows 轉檔, then the 3D view opens.
   - No network request carries the file.
   - `vendor/acad-ts` is not fetched for a PNG import.
   - A corrupt `.dwg` shows the zh/en error and causes no page error.
5. Performance: conversion runs in a Worker, so the progress UI keeps animating. Log the time for the largest fixture and flag it in review if it is over 15 s on desktop.
