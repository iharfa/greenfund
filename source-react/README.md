# Green Fund Money Map 💲💵💰💸🤑

A Vercel-ready React and Vite app for spatially mapping Maldives Green Fund spending.

The app shows:

- Island spending bubbles
- Monthly, year-to-date, and cumulative time slider
- Category filters
- Project search table
- Island detail drawer
- Data quality panel for unmapped and multi-location rows
- Money emoji design accents

## Quick start

```bash
npm install
npm run dev
```

Build for Vercel:

```bash
npm run build
```

Upload this folder to GitHub. Import the repo in Vercel. Vercel will run `npm run build` and publish the `dist` folder.

## Data files

All app data lives in `public/data`.

| File | Purpose |
|---|---|
| `green_fund_projects_summary_clean.csv` | One row per project with cleaned category and parsed location status |
| `green_fund_project_locations.csv` | One row per project-location pair |
| `green_fund_monthly_locations.csv` | Month-level map data split by location |
| `green_fund_unmapped_projects.csv` | Projects without a parsed island join |
| `green_fund_unmapped_monthly.csv` | Month-level spending without a parsed island join |
| `green_fund_category_monthly.csv` | Category trend table |
| `green_fund_category_rules.json` | Category rules and workbook totals |
| `islands.geojson` | Fallback island points used by the app |

## Connecting your islands repo

Replace:

```text
public/data/islands.geojson
```

with the GeoJSON from your islands GitHub repo.

The app joins Green Fund data to island features using one of these options:

1. A `join_key` property, like `Sh.Komandoo`
2. An atoll field plus island field, like `atoll=Sh` and `island=Komandoo`

Supported property names include:

- `join_key`, `JOIN_KEY`, `joinKey`, `spatial_key`
- `atoll`, `ATOLL`, `atoll_code`, `ATOLL_CODE`
- `island`, `ISLAND`, `island_name`, `ISLAND_NAME`, `name`, `Name`

Recommended join format:

```text
atoll_code + "." + island_name
```

Example:

```text
GDh.Thinadhoo
Sh.Milandhoo
Gn.Fuvahmulah
```

## Data quality handling

The workbook has three spatial cases:

1. Single island projects
2. Multi-island projects
3. National, regional, or unclear projects

For multi-island projects, the app splits each monthly amount equally across parsed locations. This keeps the map readable. Review these rows if the exact package split is available.

Unmapped projects stay in the dashboard totals but do not appear on the island map. Use the data quality panel to review them.

## Main files to edit

| File | What to change |
|---|---|
| `src/App.jsx` | Dashboard logic and UI layout |
| `src/styles.css` | Visual design |
| `src/data.js` | Data loading and CSV parsing |
| `src/geo.js` | GeoJSON join and projection logic |

## Currency

The dashboard uses MVR for all values. The dollar emojis are used as visual accents only.
