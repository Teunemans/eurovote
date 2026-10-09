# EuroVote

A fast, readable way to see how countries, political groups and national parties voted in European Parliament roll-call votes. It covers what MEPWatch does for single votes, with these differences:

- **One chart type for everything.** Horizontal 100% bars, one row per group, country or party. You can switch between the three with tabs (or the keys `h` / `l`).
- **Readable.** Every chart has a title, a legend, axis labels and percentages. Hover over (or tab to) a bar to see the exact numbers.
- **Colour-blind safe.** Blue means for, orange means against, grey means abstained. There's no red/green.
- **No logos needed.** Parties are shown by name with their country flag, so a missing logo can't make a chart unreadable.
- **No overflow.** Long names fit because the labels sit to the left of the bars, and the charts resize with the window. On a phone, the label goes above the bar.
- **Charts sized to their content.** The height depends on the number of rows, not on your screen size.
- **Shareable.** Every chart has **PNG / SVG / CSV / Copy** buttons. Downloaded images have a white background and include the vote title, date, selection and source. The MEP table also exports to CSV.
- **Filters combine and are kept in the address bar.** For example, "Netherlands + S&D" gives you the Dutch S&D MEPs. Once the site is published, you can send that link to someone and they see exactly the same view.

## Running it on your own computer

You need [Node.js](https://nodejs.org) version 18 or newer. There is nothing to install with npm.

```
cd EuroVote
npm start
```

Your browser opens at <http://localhost:8787>. Stop the server with `Ctrl+C`.

## Publishing it on GitHub Pages (so others can use it)

The site is just the files in `public/`, so GitHub Pages can host it for free. The workflow in `.github/workflows/deploy.yml` publishes it.

**One-time setup: the quick way**

You need the GitHub CLI once: `brew install gh`, then `gh auth login`. After that, run:

```
./scripts/publish.sh
```

This script installs the workflow file, downloads the party list, makes the first commit, creates the public repository `eurovote` on your GitHub account, switches on GitHub Pages and pushes. Then it waits for the first deploy and prints the address. You can safely run it again, because steps that are already done get skipped.

**One-time setup: by hand**

1. `mkdir -p .github/workflows && cp scripts/deploy-workflow.yml .github/workflows/deploy.yml`
2. Run `npm run update-parties` to create `public/data/parties.json`.
3. Create a new **public** repository on GitHub (e.g. `eurovote`) without a README, then:
   ```
   git init -b main && git add . && git commit -m "EuroVote"
   git remote add origin https://github.com/<your-username>/eurovote.git
   git push -u origin main
   ```
4. On GitHub, go to **Settings → Pages → Source: GitHub Actions**. Then open the **Actions** tab, choose "Deploy to GitHub Pages" and click **Run workflow**.

After a minute or two the site is live at `https://<your-username>.github.io/eurovote/`.

**After that**

- Every `git push` to `main` publishes your changes automatically.
- Every day at 05:17 UTC (07:17 Dutch summer time), the workflow downloads the EP's party list again. If anything changed, it commits the new `parties.json` and republishes. If the EP site is down, that step gets a red cross, but the site is still published with the previous party list.
- GitHub turns off scheduled workflows in repositories with no activity for 60 days. If that happens, click "Enable workflow" in the Actions tab.

## Using it quickly

| You want to… | Do this |
|---|---|
| Open a vote from MEPWatch | Paste the MEPWatch link (or just the number after `v=`, e.g. `198051`) into the search bar and press Enter |
| Find a vote | Type words or a reference like `B10-0424/2026` into the search bar |
| See one country / group / party | Use the **Countries / Groups / Parties** filters, or click a bar to zoom into it |
| Find MEPs who broke ranks | Click **Show them** under the result, or the **Broke with majority** filter in the table |
| Share a chart | **Copy** puts the image on your clipboard, so you can paste it straight into a chat or document |

## Vim keys

Press `?` in the app for the full list. Keys don't work while you're typing in a text field, so press `Esc` first. Put a number in front of a command to repeat it (`5j`). Keys you've typed but that haven't triggered a command yet show in the bottom-right corner, like Vim's showcmd.

| Keys | What they do |
|---|---|
| `j` / `k` | Next / previous item (search result, chart row or MEP) |
| `gg` / `G` | First / last item (`5G` = fifth item) |
| `Ctrl+d` / `Ctrl+u`, `zz` | Scroll half a page down / up; put the selection in the middle |
| `o` / `O` / `Enter` | Open the selection (vote, MEP page, or zoom into a bar) / open it in a new tab |
| `n` | Show more (more votes, all parties, all MEPs) |
| `/`, `H` / `L`, `gh` | Search; back / forward; home |
| `h` / `l` (or `gT` / `gt`) | Previous / next breakdown: group, country, party |
| `s` / `S`, `a` | Next / previous sort order; count MEPs who didn't vote (on/off) |
| `%` | Switch the bars between percentage and seats (number of MEPs) |
| `fc` / `fg` / `fp` | Open the Countries / Groups / Parties filter (inside it: `Ctrl+n` / `Ctrl+p` or `j` / `k` to move, `Enter` or `Space` to tick, `Esc` to close) |
| `x` / `X` | Remove the last filter / remove all filters |
| `t` / `T`, `i` | Next / previous MEP table filter; type in the MEP search box |
| `wp` `ws` `wc` | Write (download) the chart as PNG / SVG / CSV |
| `wt`, `wr` | Write the MEP table as CSV; write the result card as PNG |
| `yy`, `yc` | Copy the link to this view; copy the chart image |
| `gd` | Switch between light and dark mode (also the button in the top right) |

All the keyboard code is in `public/js/keys.js`. It has a list called `COMMANDS`, and the help screen is generated from that list, so a new key you add there shows up in the help automatically.

## How it works

```
Browser (public/)  ──►  HowTheyVote.eu API             (votes, MEPs, groups, countries)
                   └─►  public/data/parties.json       (national party of each MEP)
                              ▲
     scripts/update-parties.mjs  ◄──  europarl.europa.eu MEP lists
     (run by GitHub Actions daily, and by server.js on your computer)
```

- **The browser calls HowTheyVote.eu directly.** Their API allows other websites to use it (it sends the `Access-Control-Allow-Origin: *` header, CORS).
- **The EP's MEP list can't be read by a browser from another website** (no CORS header), so `scripts/update-parties.mjs` downloads it ahead of time and saves the result as a plain JSON file next to the site.
- **`server.js`** is only for running the site on your own computer. It serves the files in `public/` and refreshes `parties.json` when it's missing or more than a day old.
- **`.github/workflows/deploy.yml`** (a copy is kept in `scripts/deploy-workflow.yml`) publishes `public/` on GitHub Pages and refreshes the party list every day.
- **`public/js/data.js`** does the counting: filtering, totals per group/country/party, and finding "rebels".
- **`public/js/chart.js`** draws the bar chart as SVG. It uses the same code for the screen and for the downloaded image.
- **`public/js/export.js`** turns the SVG into PNG files, CSV files and clipboard images.
- **`public/js/views/`** contains the two pages: search and vote.
- **`public/js/keys.js`** handles the Vim-style keyboard commands.
- **`public/js/theme.js`** handles the light/dark switch (light by default; your choice is remembered in the browser).

### Definitions

- **Percentage vs Seats:** in *Percentage* every bar is full width, so you compare shares. In *Seats* all bars use one MEP scale, so a party with 8 MEPs gets a bar 8× as long as a party with 1. With *Count MEPs who didn't vote* ticked, the bars show the full number of seats.
- **Percentages** are shares of the MEPs **who voted** (for + against + abstained), unless you tick *Count MEPs who didn't vote*.
- **Broke with majority:** an MEP voted differently from the most common position in their political group (or national party). Non-attached MEPs have no group line. A party line needs at least two of the party's MEPs to have voted. A tie means there is no line.
- **Result:** if the official result isn't published yet, the app only says whether more MEPs voted for than against, and labels it *unofficial*. Some votes need an absolute majority, so always check the official minutes.

### Limits

- National parties come from the EP's list of current MEPs (plus the list of MEPs who left). If someone isn't on either list, they show up as "Unknown party", and the party chart tells you how many MEPs that affects.
- If the EP's party list can't be downloaded, the app still works, but without the party filter.
- Every visitor's browser loads data from HowTheyVote.eu. If the site gets a lot of visitors, let the HowTheyVote team know (and always credit them).
- The EP's party list is downloaded ahead of time, so a change of party shows up after the next daily refresh.

Data: [HowTheyVote.eu](https://howtheyvote.eu) (open data, please credit them when you share) and the [European Parliament](https://www.europarl.europa.eu/meps/en/full-list).

## License and disclaimer

- **Code:** MIT License (see `LICENSE`). Anyone may use, copy and change it. The software is provided **"as is", without warranty**, and the authors are not liable for any claim or damages arising from its use.
- **Unofficial:** EuroVote is not affiliated with the European Parliament or HowTheyVote.eu. Figures may contain errors (e.g. in the source data, the party list, or the "broke with majority" calculation). Check the official records before relying on them.
- **Vote data:** © HowTheyVote.eu, made available under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/). Every page and every exported image credits them. CSV exports are extracts of that database, so they fall under the ODbL too: whoever shares them must credit HowTheyVote.eu, and a changed version must be shared under the same license.
- **MEP photos and party list:** come from the European Parliament's website and fall under [its copyright notice](https://www.europarl.europa.eu/legal-notice/en/), not under the MIT License.

