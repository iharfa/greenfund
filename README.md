# Green Fund Money Map

Static Vercel deployment package for the Maldives Green Fund spatial spending dashboard.

This package avoids the npm install failure on Vercel by serving the already-built static app directly.

## What is inside

- `index.html` app entry file
- `assets/` compiled UI JavaScript and CSS
- `data/` cleaned Green Fund CSVs and fallback island GeoJSON
- `vercel.json` set to skip install and build steps
- `CLAUDE_CODE_PROMPT.md` prompt for future edits

## Deploy on Vercel

Use this package as the full repository contents.

Do not leave the old `package.json`, `package-lock.json`, `src/`, `node_modules/`, or `dist/` files at the repository root.

Recommended Vercel settings:

- Framework Preset: Other
- Build Command: leave empty
- Install Command: leave empty
- Output Directory: `.`

The included `vercel.json` also sets:

- `installCommand` to an empty string
- `buildCommand` to `null`
- `outputDirectory` to `.`
- `framework` to `null`

## Replace island geometry

Replace `data/islands.geojson` with the GeoJSON from your islands GitHub repo.

The app will join Green Fund spending to island features using one of these:

- `join_key`
- `JOIN_KEY`
- `island_join_key`
- `spatial_key`
- or `atoll` plus `island`

Expected join format:

`Sh.Komandoo`

## Data files

- `data/green_fund_projects_summary_clean.csv`
- `data/green_fund_project_locations.csv`
- `data/green_fund_monthly_locations.csv`
- `data/green_fund_unmapped_projects.csv`
- `data/green_fund_unmapped_monthly.csv`
- `data/green_fund_category_monthly.csv`
- `data/green_fund_category_rules.json`
- `data/islands.geojson`

## Local preview

Use any static web server. Example:

```bash
python -m http.server 4173
```

Then open:

```text
http://localhost:4173
```
