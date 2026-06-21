You are working inside a Vercel-ready React and Vite project called `green-fund-spatial-map`.

Goal: build and refine a spatial Green Fund spending dashboard for the Maldives.

Context:

- The user wants to map Maldives Green Fund spending over time.
- The app must use the existing CSV data in `public/data`.
- The app must support the user's islands GitHub repo by joining island features to spending rows.
- The UI should feel playful but still usable for public finance analysis.
- Use these emojis in the design: 💲 💵 💰 💸 🤑
- Use MVR as the currency label. Do not imply the data is in USD.

Current app behavior:

- Loads CSV and GeoJSON from `public/data`
- Renders an SVG spatial map
- Supports monthly, year-to-date, and cumulative time modes
- Supports category filters
- Supports project search
- Shows island details after clicking a map bubble
- Shows a data quality panel for unmapped and multi-location project logic

Important data files:

- `public/data/green_fund_projects_summary_clean.csv`
- `public/data/green_fund_project_locations.csv`
- `public/data/green_fund_monthly_locations.csv`
- `public/data/green_fund_unmapped_projects.csv`
- `public/data/green_fund_unmapped_monthly.csv`
- `public/data/green_fund_category_monthly.csv`
- `public/data/green_fund_category_rules.json`
- `public/data/islands.geojson`

Island join requirement:

- Prefer a `join_key` property in the islands GeoJSON.
- Join key format should be `ATOLL.ISLAND`, for example `Sh.Komandoo`.
- If `join_key` is missing, build it from atoll and island property fields.
- Keep support for common property names in `src/geo.js`.

Tasks:

1. Run `npm install` and `npm run build`.
2. Review `src/App.jsx`, `src/data.js`, `src/geo.js`, and `src/styles.css`.
3. Keep the app static and Vercel-ready. Do not add a backend unless asked.
4. Improve the map interaction if needed, but keep the current data contract stable.
5. Add any missing responsive fixes for mobile.
6. Make the UI clearer around mapped versus unmapped spending.
7. Keep data source files in `public/data` and avoid hardcoding spending values in components.
8. If the user adds the real islands GeoJSON, make sure it replaces `public/data/islands.geojson` without code changes.

Acceptance checks:

- `npm run build` passes.
- The app opens locally with `npm run dev`.
- The map renders even with fallback `islands.geojson`.
- Clicking an island updates the island detail panel.
- Category filters change the map, chart, and table.
- Time slider changes the map, chart, and table.
- Unmapped spending appears in KPI totals but not as island bubbles.
- The data quality panel explains unmapped and multi-location rows.
