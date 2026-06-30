export const DATA_FILES = {
  projects: '/data/green_fund_projects_summary_clean.csv',
  projectLocations: '/data/green_fund_project_locations.csv',
  monthlyLocations: '/data/green_fund_monthly_locations.csv',
  unmappedProjects: '/data/green_fund_unmapped_projects.csv',
  unmappedMonthly: '/data/green_fund_unmapped_monthly.csv',
  categoryMonthly: '/data/green_fund_category_monthly.csv',
  categoryRules: '/data/green_fund_category_rules.json',
  islands: '/data/islands.geojson',
  collectionMonthly: '/data/green_fund_collection_atoll_monthly.csv',
  atollBalance: '/data/green_fund_atoll_balance.csv',
  flowMonthly: '/data/green_fund_collection_vs_expenditure_monthly.csv'
};

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((value) => value !== '')) rows.push(row);
  if (!rows.length) return [];

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((values) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = values[index] ?? '';
    });
    return item;
  });
}

async function fetchCsv(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path}`);
  const text = await response.text();
  return parseCsv(text);
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return response.json();
}

export function numberValue(value) {
  const next = Number.parseFloat(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(next) ? next : 0;
}

export function cleanRow(row) {
  return {
    ...row,
    amount_mvr: numberValue(row.amount_mvr),
    allocated_amount_mvr: numberValue(row.allocated_amount_mvr),
    total_mvr: numberValue(row.total_mvr),
    location_count: numberValue(row.location_count || row.parsed_location_count || 0)
  };
}

export async function loadDashboardData() {
  const [
    projects,
    projectLocations,
    monthlyLocations,
    unmappedProjects,
    unmappedMonthly,
    categoryMonthly,
    categoryRules,
    islands,
    collectionMonthly,
    atollBalance,
    flowMonthly
  ] = await Promise.all([
    fetchCsv(DATA_FILES.projects),
    fetchCsv(DATA_FILES.projectLocations),
    fetchCsv(DATA_FILES.monthlyLocations),
    fetchCsv(DATA_FILES.unmappedProjects),
    fetchCsv(DATA_FILES.unmappedMonthly),
    fetchCsv(DATA_FILES.categoryMonthly),
    fetchJson(DATA_FILES.categoryRules),
    fetchJson(DATA_FILES.islands),
    fetchCsv(DATA_FILES.collectionMonthly),
    fetchCsv(DATA_FILES.atollBalance),
    fetchCsv(DATA_FILES.flowMonthly)
  ]);

  const cleanCollectionMonthly = collectionMonthly.map((row) => ({
    ...row,
    amount_mvr: numberValue(row.amount_mvr)
  }));
  const cleanAtollBalance = atollBalance
    .map((row) => ({
      ...row,
      collection_mvr: numberValue(row.collection_mvr),
      expenditure_mvr: numberValue(row.expenditure_mvr),
      net_flow_mvr: numberValue(row.net_flow_mvr),
      collection_share_pct: numberValue(row.collection_share_pct),
      expenditure_share_pct: numberValue(row.expenditure_share_pct)
    }))
    .sort((a, b) => b.collection_mvr - a.collection_mvr);
  const cleanFlowMonthly = flowMonthly
    .map((row) => ({
      month: row.month,
      collection_mvr: numberValue(row.collection_mvr),
      expenditure_mvr: numberValue(row.expenditure_mvr)
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const mappedMonthly = monthlyLocations.map(cleanRow);
  const cleanUnmappedMonthly = unmappedMonthly.map(cleanRow);
  const cleanProjects = projects.map(cleanRow);
  const cleanProjectLocations = projectLocations.map(cleanRow);
  const cleanCategoryMonthly = categoryMonthly.map(cleanRow);

  const months = Array.from(
    new Set([
      ...cleanCategoryMonthly.map((row) => row.month),
      ...mappedMonthly.map((row) => row.month),
      ...cleanUnmappedMonthly.map((row) => row.month)
    ])
  ).filter(Boolean).sort();

  const categories = Array.from(
    new Set([
      ...cleanProjects.map((row) => row.category),
      ...mappedMonthly.map((row) => row.category),
      ...cleanUnmappedMonthly.map((row) => row.category)
    ])
  ).filter(Boolean).sort((a, b) => a.localeCompare(b));

  return {
    projects: cleanProjects,
    projectLocations: cleanProjectLocations,
    monthlyLocations: mappedMonthly,
    unmappedProjects: unmappedProjects.map(cleanRow),
    unmappedMonthly: cleanUnmappedMonthly,
    categoryMonthly: cleanCategoryMonthly,
    categoryRules,
    islands,
    months,
    categories,
    collectionMonthly: cleanCollectionMonthly,
    atollBalance: cleanAtollBalance,
    flowMonthly: cleanFlowMonthly
  };
}

export function formatMoney(value, compact = true) {
  const amount = Number(value || 0);
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';

  if (!compact) {
    return `${sign}MVR ${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }

  if (abs >= 1_000_000_000) return `${sign}MVR ${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}MVR ${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}MVR ${(abs / 1_000).toFixed(1)}K`;
  return `${sign}MVR ${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function monthLabel(month) {
  if (!month) return '';
  const date = new Date(`${month}T00:00:00`);
  return new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' }).format(date);
}

export function categoryClassName(category) {
  return String(category || 'other')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
