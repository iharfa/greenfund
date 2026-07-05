import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkPointComponent
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import {
  categoryClassName,
  formatMoney,
  loadDashboardData,
  monthLabel
} from './data.js';

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkPointComponent,
  CanvasRenderer
]);
import {
  boundsForFeatures,
  createProjector,
  featureCentroid,
  featureJoinKey,
  featurePath,
  normalizeKey
} from './geo.js';

const MAP_WIDTH = 620;
const MAP_HEIGHT = 820;
const EMOJIS = ['💲', '💵', '💰', '💸', '🤑'];

// Geographic order, north to south, matching how islands/atolls are listed top-down.
const ATOLL_ORDER = ['HA', 'HDh', 'Sh', 'N', 'R', 'B', 'Lh', 'K', 'Male', 'AA', 'ADh', 'V', 'M', 'F', 'Dh', 'Th', 'L', 'GA', 'GDh', 'Gn', 'S'];
const atollRank = (code) => {
  const i = ATOLL_ORDER.indexOf(code);
  return i === -1 ? ATOLL_ORDER.length : i;
};

function inSelectedTime(month, selectedMonth, mode) {
  if (!month || !selectedMonth) return false;
  if (mode === 'monthly') return month === selectedMonth;
  if (mode === 'ytd') return month.slice(0, 4) === selectedMonth.slice(0, 4) && month <= selectedMonth;
  return month <= selectedMonth;
}

function groupByProject(rows) {
  const grouped = new Map();
  rows.forEach((row) => {
    const key = row.project_code || row.project_name;
    const existing = grouped.get(key) || {
      project_code: row.project_code,
      project_name: row.project_name,
      category: row.category,
      amount: 0,
      locations: new Set(),
      scope: row.spatial_scope_clean || row.spatial_scope || '',
      monthCount: new Set()
    };
    existing.amount += Number(row.allocated_amount_mvr ?? row.amount_mvr ?? 0);
    const joinKey = row.parsed_join_key || row.join_key;
    if (joinKey) existing.locations.add(joinKey);
    if (row.month) existing.monthCount.add(row.month);
    grouped.set(key, existing);
  });

  return Array.from(grouped.values())
    .map((item) => ({
      ...item,
      locationCount: item.locations.size,
      activeMonths: item.monthCount.size
    }))
    .sort((a, b) => b.amount - a.amount);
}

function groupByCategory(rows, amountField = 'allocated_amount_mvr') {
  const grouped = new Map();
  rows.forEach((row) => {
    const category = row.category || 'Other';
    grouped.set(category, (grouped.get(category) || 0) + Number(row[amountField] ?? row.amount_mvr ?? 0));
  });
  return Array.from(grouped, ([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
}

function categoryEmoji(category) {
  const text = String(category || '').toLowerCase();
  if (text.includes('waste')) return '💸';
  if (text.includes('coastal')) return '💰';
  if (text.includes('water')) return '💵';
  if (text.includes('drainage')) return '💲';
  if (text.includes('energy') || text.includes('climate')) return '🤑';
  return '💲';
}

function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [monthIndex, setMonthIndex] = useState(0);
  const [mode, setMode] = useState('cumulative');
  const [selectedCategories, setSelectedCategories] = useState(new Set());
  const [selectedIsland, setSelectedIsland] = useState('');
  const [search, setSearch] = useState('');
  const [showUnmapped, setShowUnmapped] = useState(false);
  const [view, setView] = useState('spending');

  useEffect(() => {
    loadDashboardData()
      .then((loaded) => {
        setData(loaded);
        setMonthIndex(Math.max(0, loaded.months.length - 1));
        setSelectedCategories(new Set(loaded.categories));
      })
      .catch((err) => setError(err.message));
  }, []);

  const selectedMonth = data?.months?.[monthIndex] || '';

  const selectedCategoryList = useMemo(() => Array.from(selectedCategories), [selectedCategories]);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    return data.monthlyLocations.filter((row) => {
      if (!selectedCategories.has(row.category)) return false;
      if (!inSelectedTime(row.month, selectedMonth, mode)) return false;
      if (selectedIsland && normalizeKey(row.parsed_join_key) !== selectedIsland) return false;
      return true;
    });
  }, [data, selectedCategories, selectedMonth, mode, selectedIsland]);

  const filteredUnmappedRows = useMemo(() => {
    if (!data || selectedIsland) return [];
    return data.unmappedMonthly.filter((row) => {
      if (!selectedCategories.has(row.category)) return false;
      return inSelectedTime(row.month, selectedMonth, mode);
    });
  }, [data, selectedCategories, selectedMonth, mode, selectedIsland]);

  const locationTotals = useMemo(() => {
    const grouped = new Map();
    filteredRows.forEach((row) => {
      const key = normalizeKey(row.parsed_join_key || row.join_key);
      if (!key) return;
      const existing = grouped.get(key) || {
        join_key: key,
        atoll: row.parsed_atoll || row.atoll,
        island: row.parsed_island || row.island,
        amount: 0,
        categories: {},
        projectCodes: new Set(),
        projectNames: new Set()
      };
      existing.amount += Number(row.allocated_amount_mvr || 0);
      existing.categories[row.category] = (existing.categories[row.category] || 0) + Number(row.allocated_amount_mvr || 0);
      existing.projectCodes.add(row.project_code);
      existing.projectNames.add(row.project_name);
      grouped.set(key, existing);
    });
    return grouped;
  }, [filteredRows]);

  const projectRows = useMemo(() => {
    const projects = groupByProject(filteredRows);
    const unmappedProjects = selectedIsland ? [] : groupByProject(
      filteredUnmappedRows.map((row) => ({ ...row, allocated_amount_mvr: row.amount_mvr }))
    ).map((row) => ({ ...row, scope: 'national_or_unmapped' }));
    const all = [...projects, ...unmappedProjects];
    const query = search.trim().toLowerCase();
    if (!query) return all;
    return all.filter((row) => {
      return [row.project_code, row.project_name, row.category, row.scope]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [filteredRows, filteredUnmappedRows, search, selectedIsland]);

  const categoryBreakdown = useMemo(() => {
    const mapped = groupByCategory(filteredRows, 'allocated_amount_mvr');
    const unmapped = groupByCategory(
      filteredUnmappedRows.map((row) => ({ ...row, allocated_amount_mvr: row.amount_mvr })),
      'allocated_amount_mvr'
    );
    const grouped = new Map();
    [...mapped, ...unmapped].forEach((row) => grouped.set(row.category, (grouped.get(row.category) || 0) + row.amount));
    return Array.from(grouped, ([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  }, [filteredRows, filteredUnmappedRows]);

  const timeline = useMemo(() => {
    if (!data) return [];
    return data.months.map((month) => {
      const mapped = data.monthlyLocations
        .filter((row) => selectedCategories.has(row.category) && row.month === month)
        .filter((row) => !selectedIsland || normalizeKey(row.parsed_join_key) === selectedIsland)
        .reduce((sum, row) => sum + Number(row.allocated_amount_mvr || 0), 0);
      const unmapped = selectedIsland ? 0 : data.unmappedMonthly
        .filter((row) => selectedCategories.has(row.category) && row.month === month)
        .reduce((sum, row) => sum + Number(row.amount_mvr || 0), 0);
      return { month, amount: mapped + unmapped };
    });
  }, [data, selectedCategories, selectedIsland]);

  const totals = useMemo(() => {
    const mappedSpend = filteredRows.reduce((sum, row) => sum + Number(row.allocated_amount_mvr || 0), 0);
    const unmappedSpend = filteredUnmappedRows.reduce((sum, row) => sum + Number(row.amount_mvr || 0), 0);
    const mappedIslands = Array.from(locationTotals.values()).filter((row) => row.amount > 0).length;
    const projects = new Set([...filteredRows, ...filteredUnmappedRows].map((row) => row.project_code));
    const multiLocation = data?.projects?.filter((project) => project.spatial_scope_clean === 'multi_location').length || 0;
    const unmappedProjects = data?.unmappedProjects?.length || 0;
    return {
      mappedSpend,
      unmappedSpend,
      totalSpend: mappedSpend + unmappedSpend,
      mappedIslands,
      projectCount: projects.size,
      multiLocation,
      unmappedProjects
    };
  }, [filteredRows, filteredUnmappedRows, locationTotals, data]);

  const selectedIslandData = selectedIsland ? locationTotals.get(selectedIsland) : null;

  const toggleCategory = (category) => {
    setSelectedCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const selectAllCategories = () => {
    if (!data) return;
    setSelectedCategories(new Set(data.categories));
  };

  const clearCategories = () => setSelectedCategories(new Set());

  if (error) {
    return <main className="loading error-card">Could not load dashboard data: {error}</main>;
  }

  if (!data) {
    return <main className="loading">Loading Green Fund Money Map 💸</main>;
  }

  const latestCollectionMonth = data.collectionDetail.reduce((max, row) => (row.month > max ? row.month : max), '');
  const latestCollectionYear = latestCollectionMonth.slice(0, 4);
  const latestCollectionLabel = monthLabel(latestCollectionMonth);
  const earliestCollectionYear = data.collectionDetail.reduce((min, row) => (row.month < min ? row.month : min), '9').slice(0, 4);

  const collected = data.atollBalance.reduce((s, r) => s + r.collection_mvr, 0);
  const disbursed = data.atollBalance.reduce((s, r) => s + r.expenditure_mvr, 0);
  const islandsReached = new Set(
    data.monthlyLocations.filter((r) => Number(r.allocated_amount_mvr) > 0).map((r) => normalizeKey(r.parsed_join_key)).filter(Boolean)
  ).size;
  const heroMetrics = [
    { val: formatMoney(collected), lbl: 'Green Tax collected', sub: `since ${earliestCollectionYear}` },
    { val: formatMoney(disbursed), lbl: 'Disbursed to projects', sub: `${Math.round((disbursed / collected) * 100)}% of revenue` },
    { val: data.projects.length.toLocaleString(), lbl: 'Projects funded', sub: 'across all sectors' },
    { val: islandsReached.toLocaleString(), lbl: 'Islands reached', sub: 'with mapped spending' }
  ];

  const VIEW_META = {
    spending: { kicker: 'The money map', title: 'Spending across the atolls', desc: 'Where Green Fund disbursements land, by island, category, project and month.' },
    collection: { kicker: 'Collection & redistribution', title: 'Who funds whom', desc: 'Green tax raised versus spending received per atoll — the redistribution across the country.' },
    browser: { kicker: 'The full dataset', title: 'Browse green tax collection', desc: 'MIRA monthly atoll returns, 2019–2026, by establishment type — chart, filter and export.' }
  };
  const meta = VIEW_META[view];

  return (
    <>
      <SiteHeader view={view} setView={setView} />
      <Hero metrics={heroMetrics} />
      <main className="app-shell">
        <div className="section" id="dashboard">
          <div className="section-head">
            <div className="kicker">{meta.kicker}</div>
            <h2>{meta.title}</h2>
            <p>{meta.desc}</p>
          </div>

          <nav className="view-tabs">
            <button className={view === 'spending' ? 'tab active' : 'tab'} onClick={() => setView('spending')}>
              Spending map
            </button>
            <button className={view === 'collection' ? 'tab active' : 'tab'} onClick={() => setView('collection')}>
              Collection &amp; redistribution
            </button>
            <button className={view === 'browser' ? 'tab active' : 'tab'} onClick={() => setView('browser')}>
              Data browser
            </button>
          </nav>

          {view === 'browser' && <DataBrowser detail={data.collectionDetail} />}

          {view === 'collection' && (
            <CollectionView
              atollBalance={data.atollBalance}
              collectionMonthly={data.collectionMonthly}
              flowMonthly={data.flowMonthly}
              monthlyLocations={data.monthlyLocations}
            />
          )}

          {view === 'spending' && (
          <>
      <section className="kpi-grid">
        <Kpi icon="💵" label="Selected spend" value={formatMoney(totals.totalSpend)} detail="Mapped plus unmapped" />
        <Kpi icon="💲" label="Mapped spend" value={formatMoney(totals.mappedSpend)} detail={`${totals.mappedIslands} islands shown`} />
        <Kpi icon="💸" label="Unmapped spend" value={formatMoney(totals.unmappedSpend)} detail="National or needs review" />
        <Kpi icon="🤑" label="Projects active" value={totals.projectCount.toLocaleString()} detail="Current filter window" />
      </section>

      <section className="dashboard-grid">
        <aside className="control-panel card">
          <div className="panel-section">
            <div className="section-title">Time slider</div>
            <div className="slider-label">
              <strong>{monthLabel(selectedMonth)}</strong>
              <span>{monthIndex + 1} of {data.months.length}</span>
            </div>
            <input
              className="range"
              type="range"
              min="0"
              max={data.months.length - 1}
              value={monthIndex}
              onChange={(event) => setMonthIndex(Number(event.target.value))}
            />
            <div className="mode-row">
              {[
                ['monthly', 'Monthly'],
                ['ytd', 'YTD'],
                ['cumulative', 'Cumulative']
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={mode === value ? 'pill active' : 'pill'}
                  onClick={() => setMode(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="panel-section">
            <div className="section-title with-actions">
              <span>Categories</span>
              <span>
                <button className="link-button" onClick={selectAllCategories}>All</button>
                <button className="link-button" onClick={clearCategories}>None</button>
              </span>
            </div>
            <div className="category-list">
              {data.categories.map((category) => (
                <label className="category-toggle" key={category}>
                  <input
                    type="checkbox"
                    checked={selectedCategories.has(category)}
                    onChange={() => toggleCategory(category)}
                  />
                  <span className={`category-dot ${categoryClassName(category)}`}>{categoryEmoji(category)}</span>
                  <span>{category}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="panel-section">
            <div className="section-title">Search projects</div>
            <input
              className="search"
              placeholder="Search project, code, or category"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="panel-section compact-note">
            <strong>Island join logic</strong>
            <p>
              Replace <code>public/data/islands.geojson</code> with your islands repo GeoJSON.
              The app joins on <code>join_key</code> or <code>atoll.island</code> fields.
            </p>
          </div>
        </aside>

        <section className="map-card card">
          <div className="card-header">
            <div>
              <div className="section-title">Spatial spending map</div>
              <p>{selectedIslandData ? selectedIslandData.join_key : 'Click an island bubble to inspect projects.'}</p>
            </div>
            <button className="ghost-button" onClick={() => setSelectedIsland('')}>Clear island</button>
          </div>
          <MoneyMap
            features={data.islands.features || []}
            locationTotals={locationTotals}
            selectedIsland={selectedIsland}
            onSelectIsland={setSelectedIsland}
          />
        </section>

        <aside className="detail-panel card">
          <div className="section-title">Island details</div>
          {selectedIslandData ? (
            <IslandDetails island={selectedIslandData} rows={filteredRows} />
          ) : (
            <div className="empty-detail">
              <span>🗺️</span>
              <p>Select an island to see mapped projects and category split.</p>
              <small>Current view shows {totals.mappedIslands} islands with spending.</small>
            </div>
          )}
          <button className="unmapped-toggle" onClick={() => setShowUnmapped((value) => !value)}>
            {showUnmapped ? 'Hide' : 'Show'} data quality panel 💸
          </button>
          {showUnmapped && <DataQuality totals={totals} unmappedProjects={data.unmappedProjects} />}
        </aside>
      </section>

      <section className="lower-grid">
        <TimelineChart timeline={timeline} selectedMonth={selectedMonth} onSelectMonth={(month) => setMonthIndex(data.months.indexOf(month))} />
        <CategoryBreakdown rows={categoryBreakdown} total={totals.totalSpend} />
      </section>

          <ProjectTable rows={projectRows} />
          </>
          )}
        </div>
      </main>
      <SiteFooter latestCollectionYear={latestCollectionYear} latestCollectionLabel={latestCollectionLabel} />
    </>
  );
}

function SiteHeader({ view, setView }) {
  const links = [
    ['spending', 'Money map'],
    ['collection', 'Redistribution'],
    ['browser', 'Data browser']
  ];
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <a className="logo-lockup" href="#top">
          <span className="logo-emblem" aria-hidden="true">🤑</span>
          <span className="logo-words">
            <b>Green Fund</b>
            <small>Money Map</small>
          </span>
        </a>
        <nav className="header-nav" aria-label="Primary">
          {links.map(([key, label]) => (
            <button key={key} className={view === key ? 'nav-link active' : 'nav-link'} onClick={() => setView(key)}>
              {label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}

function Hero({ metrics }) {
  return (
    <section className="hero" id="top">
      <div className="hero-inner">
        <div className="hero-kicker">Maldives Green Fund · Public transparency</div>
        <h1>Where the Green&nbsp;Tax goes.</h1>
        <p className="hero-lead">
          Every visitor to the Maldives pays a Green Tax. This dashboard traces how that money moves — from
          collection across the atolls to the projects it funds — using official MIRA collection returns and
          published Green Fund spending.
        </p>
        <div className="hero-metrics">
          {metrics.map((m) => (
            <div className="hero-metric" key={m.lbl}>
              <div className="val">{m.val}</div>
              <div className="lbl">{m.lbl}</div>
              <div className="sub">{m.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SiteFooter({ latestCollectionYear, latestCollectionLabel }) {
  return (
    <footer className="site-footer" id="about">
      <div className="footer-inner">
        <div className="footer-top">
          <div className="footer-about">
            <div className="kicker">About</div>
            <h3>The Green Fund, in brief</h3>
            <p>
              A Green Tax is charged per guest, per night at tourist facilities. Revenue flows into the Green Fund,
              which finances environmental infrastructure — waste management, water and sewerage, coastal protection,
              harbours and renewable energy — on islands across the country.
            </p>
          </div>
          <div className="footer-cols">
            <nav className="footer-col" aria-label="Data links">
              <span className="col-head">Data</span>
              <a href="#dashboard">Money map</a>
              <a href="#dashboard">Redistribution</a>
              <a href="#dashboard">Data browser</a>
            </nav>
            <nav className="footer-col" aria-label="Source links">
              <span className="col-head">Source</span>
              <a href="https://www.mira.gov.mv" target="_blank" rel="noreferrer">MIRA</a>
              <a href="https://www.finance.gov.mv" target="_blank" rel="noreferrer">Ministry of Finance</a>
            </nav>
          </div>
        </div>
        <div className="footer-rule" />
        <div className="footer-note">
          <p>
            Green tax collection figures are reported by the Maldives Inland Revenue Authority (MIRA) at the
            atoll/city level only. MIRA is unable to provide data at a resolution that would allow individual
            taxpayers to be identified, so collection cannot be disaggregated below the atoll.
          </p>
          <p>
            <strong className="warn-flag">⚠ {latestCollectionYear} is a partial year.</strong> Collection data runs
            through {latestCollectionLabel}, so any total spanning all years includes an incomplete final year and will
            understate it. Year-on-year comparisons should use complete years only.
          </p>
          <p>
            Collection is keyed by atoll/city while spending is keyed by island then rolled up to atoll. Malé City
            raises green tax but has no spending mapped to it in the published data (likely recorded as national or
            unmapped), so its net-flow overstates the true redistribution. Net-flow and share comparisons are
            indicative, not audited reconciliations.
          </p>
        </div>
        <div className="footer-meta">
          <span>Green Fund Money Map · Spatial dashboard for Maldives Green Fund spending</span>
          <span>Data: MIRA &amp; Ministry of Finance</span>
        </div>
      </div>
    </footer>
  );
}

function modeLabel(mode) {
  if (mode === 'monthly') return 'Monthly spending';
  if (mode === 'ytd') return 'Year to date spending';
  return 'Cumulative spending';
}

function Kpi({ icon, label, value, detail }) {
  return (
    <article className="kpi card">
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{detail}</em>
      </div>
    </article>
  );
}

function MoneyMap({ features, locationTotals, selectedIsland, onSelectIsland }) {
  const bounds = useMemo(() => boundsForFeatures(features), [features]);
  const project = useMemo(() => createProjector(bounds, MAP_WIDTH, MAP_HEIGHT), [bounds]);
  const totals = Array.from(locationTotals.values()).map((row) => Math.max(0, row.amount));
  const maxAmount = Math.max(...totals, 1);

  const featureItems = features.map((feature, index) => {
    const key = normalizeKey(featureJoinKey(feature));
    const centroid = featureCentroid(feature);
    const [x, y] = project(centroid);
    const total = key ? locationTotals.get(key) : null;
    const radius = total ? 4 + Math.sqrt(Math.max(total.amount, 0) / maxAmount) * 26 : 2.8;
    const path = featurePath(feature, project);
    const active = Boolean(total);
    const selected = key && selectedIsland === key;

    return { feature, index, key, x, y, radius, path, active, selected, total };
  });

  const activeItems = featureItems.filter((item) => item.active).sort((a, b) => a.radius - b.radius);
  const baseItems = featureItems.filter((item) => !item.active);
  const topSpenders = Array.from(locationTotals.values()).sort((a, b) => b.amount - a.amount).slice(0, 5);

  return (
    <div className="map-wrap">
      <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} role="img" aria-label="Green Fund spending map">
        <defs>
          <radialGradient id="moneyGradient" cx="35%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#f7ffe8" />
            <stop offset="55%" stopColor="#8bd450" />
            <stop offset="100%" stopColor="#2f7d32" />
          </radialGradient>
        </defs>
        <rect className="map-ocean" x="0" y="0" width={MAP_WIDTH} height={MAP_HEIGHT} rx="28" />
        <g>
          {baseItems.map((item) => item.path ? (
            <path key={`base-${item.index}`} className="island-shape" d={item.path} />
          ) : (
            <circle key={`base-${item.index}`} className="island-dot" cx={item.x} cy={item.y} r="2" />
          ))}
        </g>
        <g>
          {activeItems.map((item) => item.path ? (
            <path
              key={`active-shape-${item.index}`}
              className={item.selected ? 'island-shape active selected' : 'island-shape active'}
              d={item.path}
              onClick={() => onSelectIsland(item.key)}
            />
          ) : null)}
        </g>
        <g>
          {activeItems.map((item) => (
            <g key={`bubble-${item.index}`} className="bubble-group" onClick={() => onSelectIsland(item.key)}>
              <circle
                className={item.selected ? 'money-bubble selected' : 'money-bubble'}
                cx={item.x}
                cy={item.y}
                r={item.radius}
              />
              <text x={item.x} y={item.y + 4} textAnchor="middle" className="bubble-emoji">
                {item.total.amount > 100_000_000 ? '💰' : item.total.amount > 20_000_000 ? '💵' : '💲'}
              </text>
              <title>{item.key}: {formatMoney(item.total.amount, false)}</title>
            </g>
          ))}
        </g>
      </svg>
      <div className="map-legend">
        <strong>Top island spends</strong>
        {topSpenders.map((row, index) => (
          <button key={row.join_key} onClick={() => onSelectIsland(row.join_key)}>
            <span>{index + 1}</span>
            <b>{row.join_key}</b>
            <em>{formatMoney(row.amount, false)}</em>
          </button>
        ))}
      </div>
    </div>
  );
}

function IslandDetails({ island, rows }) {
  const islandRows = rows.filter((row) => normalizeKey(row.parsed_join_key) === island.join_key);
  const projects = groupByProject(islandRows).slice(0, 8);
  const categories = groupByCategory(islandRows).slice(0, 6);
  const total = island.amount || 1;

  return (
    <div className="island-details">
      <div className="selected-island-card">
        <span>💰</span>
        <div>
          <strong>{island.join_key}</strong>
          <small>{formatMoney(island.amount, false)}</small>
        </div>
      </div>
      <div className="mini-list">
        <strong>Category split</strong>
        {categories.map((row) => (
          <div className="bar-row" key={row.category}>
            <span>{categoryEmoji(row.category)} {row.category}</span>
            <em>{formatMoney(row.amount)}</em>
            <div><i style={{ width: `${Math.max(4, (row.amount / total) * 100)}%` }} /></div>
          </div>
        ))}
      </div>
      <div className="mini-list">
        <strong>Top projects</strong>
        {projects.map((row) => (
          <article key={row.project_code} className="mini-project">
            <span>{categoryEmoji(row.category)}</span>
            <div>
              <b>{row.project_name}</b>
              <small>{formatMoney(row.amount)} · {row.category}</small>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function DataQuality({ totals, unmappedProjects }) {
  return (
    <div className="quality-panel">
      <div className="quality-grid">
        <span><b>{totals.unmappedProjects}</b><small>unmapped projects</small></span>
        <span><b>{totals.multiLocation}</b><small>multi-island projects</small></span>
      </div>
      <p>
        Unmapped rows have no valid atoll.island pattern. Multi-location rows are split equally for the map.
        Review these when exact island package amounts matter.
      </p>
      <div className="unmapped-list">
        {unmappedProjects.slice(0, 8).map((row) => (
          <div key={row.project_code}>
            <b>{row.project_name}</b>
            <small>{formatMoney(row.total_mvr)} · {row.category}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineChart({ timeline, selectedMonth, onSelectMonth }) {
  const width = 820;
  const height = 250;
  const padding = 34;
  const max = Math.max(...timeline.map((row) => Math.max(0, row.amount)), 1);
  const barWidth = Math.max(3, (width - padding * 2) / Math.max(1, timeline.length) - 2);

  return (
    <section className="card chart-card">
      <div className="card-header">
        <div>
          <div className="section-title">Monthly spending timeline</div>
          <p>Click a bar to move the time slider.</p>
        </div>
        <strong>{monthLabel(selectedMonth)}</strong>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="timeline-chart" role="img" aria-label="Monthly Green Fund spending timeline">
        <line x1={padding} x2={width - padding} y1={height - padding} y2={height - padding} className="axis-line" />
        {timeline.map((row, index) => {
          const x = padding + index * ((width - padding * 2) / Math.max(1, timeline.length));
          const h = Math.max(1, (Math.max(0, row.amount) / max) * (height - padding * 2));
          const y = height - padding - h;
          const selected = row.month === selectedMonth;
          return (
            <g key={row.month} onClick={() => onSelectMonth(row.month)} className="timeline-bar-group">
              <rect
                className={selected ? 'timeline-bar selected' : 'timeline-bar'}
                x={x}
                y={y}
                width={barWidth}
                height={h}
                rx="2"
              />
              <title>{monthLabel(row.month)}: {formatMoney(row.amount, false)}</title>
            </g>
          );
        })}
        <text x={padding} y="22" className="chart-note">Peak: {formatMoney(max)}</text>
      </svg>
    </section>
  );
}

function CategoryBreakdown({ rows, total }) {
  return (
    <section className="card category-card">
      <div className="section-title">Category breakdown</div>
      <div className="category-bars">
        {rows.map((row) => (
          <div className="category-bar" key={row.category}>
            <div>
              <span>{categoryEmoji(row.category)} {row.category}</span>
              <strong>{formatMoney(row.amount)}</strong>
            </div>
            <i style={{ width: `${Math.max(3, Math.abs(row.amount) / Math.max(Math.abs(total), 1) * 100)}%` }} />
          </div>
        ))}
      </div>
    </section>
  );
}

function ProjectTable({ rows }) {
  return (
    <section className="card table-card">
      <div className="card-header">
        <div>
          <div className="section-title">Filtered projects</div>
          <p>Sorted by selected spending amount.</p>
        </div>
        <strong>{rows.length.toLocaleString()} projects</strong>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Category</th>
              <th>Locations</th>
              <th>Months</th>
              <th>Spend</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 80).map((row) => (
              <tr key={`${row.project_code}-${row.scope}`}>
                <td>
                  <b>{row.project_name}</b>
                  <small>{row.project_code}</small>
                </td>
                <td><span className="table-category">{categoryEmoji(row.category)} {row.category}</span></td>
                <td>{row.locationCount || row.scope || 'Unmapped'}</td>
                <td>{row.activeMonths}</td>
                <td>{formatMoney(row.amount, false)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const TYPE_COLORS = {
  Resorts: '#2f7d32',
  Hotels: '#8bd450',
  Guesthouse: '#f2b705',
  Vessels: '#3aa0ff'
};

function CollectionView({ atollBalance, collectionMonthly, flowMonthly, monthlyLocations }) {
  const [selectedAtoll, setSelectedAtoll] = useState('');

  const totals = useMemo(() => {
    const collection = atollBalance.reduce((s, r) => s + r.collection_mvr, 0);
    const expenditure = atollBalance.reduce((s, r) => s + r.expenditure_mvr, 0);
    const contributors = atollBalance.filter((r) => r.net_flow_mvr > 0).length;
    const beneficiaries = atollBalance.filter((r) => r.net_flow_mvr < 0).length;
    return { collection, expenditure, retained: collection - expenditure, contributors, beneficiaries };
  }, [atollBalance]);

  const composition = useMemo(() => {
    const grouped = new Map();
    collectionMonthly.forEach((row) => {
      const key = row.atoll_code;
      const entry = grouped.get(key) || { atoll_code: key, total: 0, Resorts: 0, Hotels: 0, Guesthouse: 0, Vessels: 0 };
      entry[row.establishment_type] = (entry[row.establishment_type] || 0) + row.amount_mvr;
      entry.total += row.amount_mvr;
      grouped.set(key, entry);
    });
    return grouped;
  }, [collectionMonthly]);

  const atollCategoryMix = useMemo(() => {
    if (!selectedAtoll) return [];
    return groupByCategory(
      monthlyLocations.filter((row) => normalizeAtoll(row.parsed_atoll) === selectedAtoll),
      'allocated_amount_mvr'
    ).filter((r) => r.amount > 0).slice(0, 6);
  }, [selectedAtoll, monthlyLocations]);

  const selected = selectedAtoll ? atollBalance.find((r) => r.atoll_code === selectedAtoll) : null;

  return (
    <>
      <section className="kpi-grid">
        <Kpi icon="🟢" label="Green tax collected" value={formatMoney(totals.collection)} detail="All atolls · 2019–2025" />
        <Kpi icon="💸" label="Green fund spent" value={formatMoney(totals.expenditure)} detail="Mapped island spending" />
        <Kpi icon="🏦" label="Net retained" value={formatMoney(totals.retained)} detail="Collected minus spent" />
        <Kpi icon="⚖️" label="Redistribution" value={`${totals.contributors} → ${totals.beneficiaries}`} detail="Net donor → net recipient atolls" />
      </section>

      <section className="lower-grid">
        <RedistributionChart rows={atollBalance} selectedAtoll={selectedAtoll} onSelect={setSelectedAtoll} />
        <ShareCompareChart rows={atollBalance} selectedAtoll={selectedAtoll} onSelect={setSelectedAtoll} />
      </section>

      <section className="lower-grid one-col">
        <CompositionChart composition={composition} balance={atollBalance} selectedAtoll={selectedAtoll} onSelect={setSelectedAtoll} />
      </section>

      <section className="lower-grid one-col">
        <FlowTimeline flow={flowMonthly} />
      </section>

      <section className="card table-card">
        <div className="card-header">
          <div>
            <div className="section-title">Atoll balance · does spending follow collection?</div>
            <p>{selected ? `${selected.atoll_label}: collects ${selected.collection_share_pct}% of tax, receives ${selected.expenditure_share_pct}% of spending.` : 'Click any atoll to inspect its category spending mix.'}</p>
          </div>
          <strong>{atollBalance.length} atolls</strong>
        </div>
        {selected && atollCategoryMix.length > 0 && (
          <div className="mini-list atoll-mix">
            <strong>{selected.atoll_label} — green fund spending by category</strong>
            {atollCategoryMix.map((row) => (
              <div className="bar-row" key={row.category}>
                <span>{categoryEmoji(row.category)} {row.category}</span>
                <em>{formatMoney(row.amount)}</em>
                <div><i style={{ width: `${Math.max(4, (row.amount / atollCategoryMix[0].amount) * 100)}%` }} /></div>
              </div>
            ))}
          </div>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Atoll</th>
                <th>Collected</th>
                <th>Spent</th>
                <th>Net flow</th>
                <th>Collect %</th>
                <th>Spend %</th>
              </tr>
            </thead>
            <tbody>
              {[...atollBalance].sort((a, b) => atollRank(a.atoll_code) - atollRank(b.atoll_code)).map((row) => (
                <tr
                  key={row.atoll_code}
                  className={selectedAtoll === row.atoll_code ? 'row-selected' : ''}
                  onClick={() => setSelectedAtoll(row.atoll_code === selectedAtoll ? '' : row.atoll_code)}
                >
                  <td><b>{row.atoll_label}</b></td>
                  <td className="cell-collected">{formatMoney(row.collection_mvr)}</td>
                  <td className="cell-spent">{formatMoney(row.expenditure_mvr)}</td>
                  <td className={row.net_flow_mvr >= 0 ? 'net-pos' : 'net-neg'}>{formatMoney(row.net_flow_mvr)}</td>
                  <td>{row.collection_share_pct}%</td>
                  <td>{row.expenditure_share_pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function RedistributionChart({ rows, selectedAtoll, onSelect }) {
  const sorted = [...rows].sort((a, b) => atollRank(a.atoll_code) - atollRank(b.atoll_code));
  const max = Math.max(...sorted.map((r) => Math.abs(r.net_flow_mvr)), 1);
  return (
    <section className="card chart-card">
      <div className="section-title">Net flow by atoll · who funds whom</div>
      <p className="chart-sub">Green = raises more tax than it receives in spending. Red = net beneficiary.</p>
      <div className="diverging">
        {sorted.map((row) => {
          const pct = (Math.abs(row.net_flow_mvr) / max) * 50;
          const pos = row.net_flow_mvr >= 0;
          return (
            <button
              key={row.atoll_code}
              className={`div-row ${selectedAtoll === row.atoll_code ? 'sel' : ''}`}
              onClick={() => onSelect(row.atoll_code === selectedAtoll ? '' : row.atoll_code)}
            >
              <span className="div-label">{row.atoll_code}</span>
              <div className="div-track">
                <div className="div-mid" />
                <i className={pos ? 'div-bar pos' : 'div-bar neg'} style={{ width: `${pct}%`, left: pos ? '50%' : `${50 - pct}%` }} />
              </div>
              <em className={pos ? 'net-pos' : 'net-neg'}>{formatMoney(row.net_flow_mvr)}</em>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ShareCompareChart({ rows, selectedAtoll, onSelect }) {
  const sorted = [...rows].sort((a, b) => atollRank(a.atoll_code) - atollRank(b.atoll_code));
  const max = Math.max(...sorted.flatMap((r) => [r.collection_share_pct, r.expenditure_share_pct]), 1);
  return (
    <section className="card chart-card">
      <div className="section-title">Share of collection vs share of spending</div>
      <p className="chart-sub"><span className="swatch swatch-c" /> collection share &nbsp; <span className="swatch swatch-e" /> spending share</p>
      <div className="share-list">
        {sorted.map((row) => (
          <button
            key={row.atoll_code}
            className={`share-row ${selectedAtoll === row.atoll_code ? 'sel' : ''}`}
            onClick={() => onSelect(row.atoll_code === selectedAtoll ? '' : row.atoll_code)}
          >
            <span className="share-label">{row.atoll_code}</span>
            <div className="share-bars">
              <i className="share-bar c" style={{ width: `${(row.collection_share_pct / max) * 100}%` }} />
              <i className="share-bar e" style={{ width: `${(row.expenditure_share_pct / max) * 100}%` }} />
            </div>
            <em>{row.collection_share_pct}% / {row.expenditure_share_pct}%</em>
          </button>
        ))}
      </div>
    </section>
  );
}

function CompositionChart({ composition, balance, selectedAtoll, onSelect }) {
  const types = ['Resorts', 'Hotels', 'Guesthouse', 'Vessels'];
  const rows = balance
    .map((b) => composition.get(b.atoll_code))
    .filter((r) => r && r.total > 0)
    .sort((a, b) => atollRank(a.atoll_code) - atollRank(b.atoll_code));
  return (
    <section className="card chart-card">
      <div className="section-title">What drives each atoll's tax base</div>
      <p className="chart-sub">
        {types.map((t) => (
          <span key={t} className="legend-chip"><i style={{ background: TYPE_COLORS[t] }} /> {t}</span>
        ))}
      </p>
      <div className="comp-list">
        {rows.map((row) => (
          <button
            key={row.atoll_code}
            className={`comp-row ${selectedAtoll === row.atoll_code ? 'sel' : ''}`}
            onClick={() => onSelect(row.atoll_code === selectedAtoll ? '' : row.atoll_code)}
          >
            <span className="comp-label">{row.atoll_code}</span>
            <div className="comp-bar">
              {types.map((t) => row[t] > 0 ? (
                <i key={t} style={{ width: `${(row[t] / row.total) * 100}%`, background: TYPE_COLORS[t] }} title={`${t}: ${formatMoney(row[t])}`} />
              ) : null)}
            </div>
            <em>{formatMoney(row.total)}</em>
          </button>
        ))}
      </div>
    </section>
  );
}

function FlowTimeline({ flow }) {
  const width = 820;
  const height = 250;
  const padding = 36;
  const max = Math.max(...flow.flatMap((r) => [r.collection_mvr, r.expenditure_mvr]), 1);
  const x = (i) => padding + i * ((width - padding * 2) / Math.max(1, flow.length - 1));
  const y = (v) => height - padding - (v / max) * (height - padding * 2);
  const line = (key) => flow.map((r, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(r[key]).toFixed(1)}`).join(' ');
  return (
    <section className="card chart-card">
      <div className="card-header">
        <div>
          <div className="section-title">Collection vs spending over time</div>
          <p className="chart-sub"><span className="swatch swatch-c" /> monthly collection &nbsp; <span className="swatch swatch-e" /> monthly spending</p>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="timeline-chart" role="img" aria-label="Collection vs spending timeline">
        <line x1={padding} x2={width - padding} y1={height - padding} y2={height - padding} className="axis-line" />
        <path d={line('collection_mvr')} fill="none" stroke="#2f7d32" strokeWidth="2.5" />
        <path d={line('expenditure_mvr')} fill="none" stroke="#f2b705" strokeWidth="2.5" />
        <text x={padding} y="22" className="chart-note">Peak month: {formatMoney(max)}</text>
        <text x={padding} y={height - 8} className="chart-note">{flow[0]?.month?.slice(0, 7)}</text>
        <text x={width - padding} y={height - 8} className="chart-note" textAnchor="end">{flow[flow.length - 1]?.month?.slice(0, 7)}</text>
      </svg>
    </section>
  );
}

function normalizeAtoll(code) {
  return String(code || '').trim();
}

function DataBrowser({ detail }) {
  const [year, setYear] = useState('all');
  const [atoll, setAtoll] = useState('all');
  const [type, setType] = useState('all');
  const [currency, setCurrency] = useState('MVR');
  const [sortKey, setSortKey] = useState('month');
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 100;

  const years = useMemo(() => Array.from(new Set(detail.map((r) => r.year))).sort(), [detail]);
  const yearMaxMonth = useMemo(() => {
    const max = {};
    detail.forEach((r) => {
      const mo = r.month.slice(5, 7);
      if (!max[r.year] || mo > max[r.year]) max[r.year] = mo;
    });
    return max;
  }, [detail]);
  const isPartial = (y) => yearMaxMonth[y] && yearMaxMonth[y] < '12';
  const atolls = useMemo(
    () => Array.from(new Map(detail.map((r) => [r.atoll_code, r.atoll_label])).entries()).sort((a, b) => atollRank(a[0]) - atollRank(b[0])),
    [detail]
  );
  const types = useMemo(() => Array.from(new Set(detail.map((r) => r.establishment_type))), [detail]);
  const amountKey = currency === 'USD' ? 'usd_amount' : 'mvr_amount';

  const filtered = useMemo(() => {
    return detail.filter((r) => {
      if (year !== 'all' && r.year !== year) return false;
      if (atoll !== 'all' && r.atoll_code !== atoll) return false;
      if (type !== 'all' && r.establishment_type !== type) return false;
      return true;
    });
  }, [detail, year, atoll, type]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      let va = a[sortKey];
      let vb = b[sortKey];
      if (sortKey === 'amount') { va = a[amountKey]; vb = b[amountKey]; }
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
    return rows;
  }, [filtered, sortKey, sortDir, amountKey]);

  const total = useMemo(() => filtered.reduce((s, r) => s + r[amountKey], 0), [filtered, amountKey]);
  const pageRows = sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));

  const setSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'amount' ? 'desc' : 'asc'); }
    setPage(0);
  };

  const downloadCsv = () => {
    const header = 'month,atoll_code,atoll_label,establishment_type,usd_amount,mvr_amount\n';
    const body = sorted
      .map((r) => [r.month, r.atoll_code, `"${r.atoll_label}"`, r.establishment_type, r.usd_amount, r.mvr_amount].join(','))
      .join('\n');
    const blob = new Blob([header + body], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'green_tax_collection_filtered.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const arrow = (key) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');
  const fmt = (v) => (currency === 'USD' ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : formatMoney(v, false));

  return (
    <>
    <CollectionChart detail={detail} />
    <section className="card table-card">
      <div className="card-header">
        <div>
          <div className="section-title">Green tax collection — browsable dataset</div>
          <p>Source: MIRA monthly atoll returns, 2019–2026. {detail.length.toLocaleString()} records · resort / hotel / guesthouse / vessel by atoll.</p>
        </div>
        <button className="ghost-button" onClick={downloadCsv}>⬇ Export filtered CSV</button>
      </div>

      <div className="browser-filters">
        <label>Year
          <select value={year} onChange={(e) => { setYear(e.target.value); setPage(0); }}>
            <option value="all">All years</option>
            {years.map((y) => <option key={y} value={y}>{isPartial(y) ? `${y} (partial)` : y}</option>)}
          </select>
        </label>
        <label>Atoll
          <select value={atoll} onChange={(e) => { setAtoll(e.target.value); setPage(0); }}>
            <option value="all">All atolls</option>
            {atolls.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </label>
        <label>Establishment
          <select value={type} onChange={(e) => { setType(e.target.value); setPage(0); }}>
            <option value="all">All types</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>Currency
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="MVR">MVR</option>
            <option value="USD">USD</option>
          </select>
        </label>
      </div>

      <div className="browser-summary">
        <span><b>{filtered.length.toLocaleString()}</b> rows</span>
        <span>Total: <b>{fmt(total)}</b></span>
        <span>Page {page + 1} of {pageCount}</span>
        {(year === 'all' || isPartial(year)) && (
          <span className="partial-badge">
            ⚠ {year === 'all'
              ? `includes partial year ${Object.keys(yearMaxMonth).filter(isPartial).join(', ')}`
              : `${year} is a partial year (through ${monthLabel(`${year}-${yearMaxMonth[year]}-01`)})`}
          </span>
        )}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th onClick={() => setSort('month')} className="sortable">Month{arrow('month')}</th>
              <th onClick={() => setSort('atoll_label')} className="sortable">Atoll{arrow('atoll_label')}</th>
              <th onClick={() => setSort('establishment_type')} className="sortable">Establishment{arrow('establishment_type')}</th>
              <th onClick={() => setSort('amount')} className="sortable">{currency} collected{arrow('amount')}</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, i) => (
              <tr key={`${r.month}-${r.atoll_code}-${r.establishment_type}-${i}`}>
                <td>{monthLabel(r.month)}</td>
                <td><b>{r.atoll_label}</b></td>
                <td>{r.establishment_type}</td>
                <td>{fmt(r[amountKey])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="browser-pager">
        <button className="ghost-button" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>← Prev</button>
        <span>{page * PAGE_SIZE + 1}–{Math.min(sorted.length, (page + 1) * PAGE_SIZE)} of {sorted.length.toLocaleString()}</span>
        <button className="ghost-button" disabled={page >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}>Next →</button>
      </div>
    </section>
    </>
  );
}

const CHART_TYPES = ['Resorts', 'Hotels', 'Guesthouse', 'Vessels'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SERIES_PALETTE = ['#2f7d32', '#f2b705', '#3aa0ff', '#c0392b', '#8e44ad', '#16a085', '#e67e22', '#2c3e50'];

function CollectionChart({ detail }) {
  const chartRef = useRef(null);
  const instanceRef = useRef(null);
  const [mode, setMode] = useState('trend');
  const [currency, setCurrency] = useState('MVR');
  const [groupBy, setGroupBy] = useState('atoll');
  const [types, setTypes] = useState(() => new Set(CHART_TYPES));
  const [atolls, setAtolls] = useState(null);

  const amountKey = currency === 'USD' ? 'usd_amount' : 'mvr_amount';

  const totalsByAtoll = useMemo(() => {
    const totals = new Map();
    const labels = new Map();
    detail.forEach((r) => {
      totals.set(r.atoll_code, (totals.get(r.atoll_code) || 0) + r.mvr_amount);
      labels.set(r.atoll_code, r.atoll_label);
    });
    return { totals, labels };
  }, [detail]);

  // Chips listed in geographic order (north to south).
  const atollList = useMemo(
    () => Array.from(totalsByAtoll.totals.keys())
      .sort((a, b) => atollRank(a) - atollRank(b))
      .map((code) => ({ code, label: totalsByAtoll.labels.get(code) })),
    [totalsByAtoll]
  );

  // Highest-collecting atolls, used for the "Top 5" default and shortcut.
  const topFiveCodes = useMemo(
    () => Array.from(totalsByAtoll.totals.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([code]) => code),
    [totalsByAtoll]
  );

  const selectedAtolls = atolls ?? new Set(topFiveCodes);

  const months = useMemo(
    () => Array.from(new Set(detail.map((r) => r.month))).sort(),
    [detail]
  );

  const yearMaxMonth = useMemo(() => {
    const max = {};
    detail.forEach((r) => {
      const y = r.month.slice(0, 4);
      const mo = r.month.slice(5, 7);
      if (!max[y] || mo > max[y]) max[y] = mo;
    });
    return max;
  }, [detail]);
  const completeYears = useMemo(
    () => new Set(Object.entries(yearMaxMonth).filter(([, mo]) => mo === '12').map(([y]) => y)),
    [yearMaxMonth]
  );

  const option = useMemo(() => {
    const codes = atollList.filter((a) => selectedAtolls.has(a.code));

    // Each "group" becomes one line: either one per selected atoll (types summed),
    // or one per selected establishment type (atolls summed).
    const groups = groupBy === 'type'
      ? CHART_TYPES.filter((t) => types.has(t)).map((t) => ({
          name: t,
          color: TYPE_COLORS[t],
          match: (r) => selectedAtolls.has(r.atoll_code) && r.establishment_type === t
        }))
      : codes.map((a, i) => ({
          name: a.label,
          color: SERIES_PALETTE[i % SERIES_PALETTE.length],
          match: (r) => r.atoll_code === a.code && types.has(r.establishment_type)
        }));

    if (mode === 'season') {
      const series = groups.map((g) => {
        const sums = Array(12).fill(0);
        const counts = Array(12).fill(0);
        const byMonthYear = new Map();
        detail.forEach((r) => {
          if (!g.match(r)) return;
          if (!completeYears.has(r.month.slice(0, 4))) return; // complete years only for fair seasonality
          const mIdx = Number(r.month.slice(5, 7)) - 1;
          const key = mIdx + ':' + r.month.slice(0, 4);
          byMonthYear.set(key, (byMonthYear.get(key) || 0) + r[amountKey]);
        });
        byMonthYear.forEach((val, key) => {
          const mIdx = Number(key.split(':')[0]);
          sums[mIdx] += val;
          counts[mIdx] += 1;
        });
        const avg = sums.map((s, idx) => (counts[idx] ? s / counts[idx] : 0));
        const mean = avg.reduce((x, y) => x + y, 0) / 12;
        return {
          name: g.name,
          type: 'line',
          smooth: true,
          symbolSize: 6,
          data: avg.map((v) => Math.round(v)),
          color: g.color,
          markPoint: { data: [{ type: 'max', name: 'High season' }, { type: 'min', name: 'Low season' }], symbolSize: 42 },
          markLine: { silent: true, symbol: 'none', lineStyle: { type: 'dashed', opacity: 0.5 }, data: [{ yAxis: Math.round(mean), name: 'avg' }] }
        };
      });
      return {
        tooltip: { trigger: 'axis', valueFormatter: (v) => fmtAxis(v, currency) },
        legend: { top: 0, textStyle: { color: '#1f3a24' } },
        grid: { left: 64, right: 24, top: 40, bottom: 40 },
        xAxis: { type: 'category', data: MONTH_NAMES, boundaryGap: false },
        yAxis: { type: 'value', axisLabel: { formatter: (v) => fmtAxis(v, currency) } },
        series
      };
    }

    // trend mode
    const series = groups.map((g) => {
      const byMonth = new Map();
      detail.forEach((r) => {
        if (!g.match(r)) return;
        byMonth.set(r.month, (byMonth.get(r.month) || 0) + r[amountKey]);
      });
      return {
        name: g.name,
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: months.map((mo) => Math.round(byMonth.get(mo) || 0)),
        color: g.color
      };
    });
    return {
      tooltip: { trigger: 'axis', valueFormatter: (v) => fmtAxis(v, currency) },
      legend: { top: 0, textStyle: { color: '#1f3a24' } },
      grid: { left: 64, right: 24, top: 40, bottom: 72 },
      xAxis: { type: 'category', data: months.map((m) => monthLabel(m)), boundaryGap: false },
      yAxis: { type: 'value', axisLabel: { formatter: (v) => fmtAxis(v, currency) } },
      dataZoom: [
        { type: 'slider', start: 0, end: 100, bottom: 8 },
        { type: 'inside' }
      ],
      series
    };
  }, [detail, mode, currency, groupBy, types, selectedAtolls, atollList, months, amountKey, completeYears]);

  useEffect(() => {
    if (!chartRef.current) return;
    if (!instanceRef.current) instanceRef.current = echarts.init(chartRef.current);
    instanceRef.current.setOption(option, true);
    const onResize = () => instanceRef.current && instanceRef.current.resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [option]);

  useEffect(() => () => { if (instanceRef.current) { instanceRef.current.dispose(); instanceRef.current = null; } }, []);

  const toggleType = (t) => setTypes((cur) => {
    const next = new Set(cur);
    if (next.has(t)) next.delete(t); else next.add(t);
    return next;
  });
  const toggleAtoll = (code) => setAtolls(() => {
    const next = new Set(selectedAtolls);
    if (next.has(code)) next.delete(code); else next.add(code);
    return next;
  });

  return (
    <section className="card chart-card">
      <div className="card-header">
        <div>
          <div className="section-title">Green tax collection — interactive trends &amp; seasonality</div>
          <p>
            {mode === 'trend'
              ? `Monthly collection, one line per ${groupBy === 'type' ? 'establishment type (atolls summed)' : 'atoll (types summed)'}. Drag the slider to change the date range; click legend items to toggle lines.`
              : `Average collection by calendar month (complete years only), one line per ${groupBy === 'type' ? 'establishment type' : 'atoll'} — peaks mark the high season, troughs the low season.`}
          </p>
        </div>
        <div className="mode-row">
          <button className={mode === 'trend' ? 'pill active' : 'pill'} onClick={() => setMode('trend')}>Trend</button>
          <button className={mode === 'season' ? 'pill active' : 'pill'} onClick={() => setMode('season')}>Seasonality</button>
        </div>
      </div>

      <div className="chart-controls">
        <div className="control-block">
          <span className="control-label">Break down by</span>
          <div className="mode-row">
            <button className={groupBy === 'atoll' ? 'pill active' : 'pill'} onClick={() => setGroupBy('atoll')}>Atoll</button>
            <button className={groupBy === 'type' ? 'pill active' : 'pill'} onClick={() => setGroupBy('type')}>Establishment</button>
          </div>
        </div>
        <div className="control-block">
          <span className="control-label">Establishments {groupBy === 'type' ? '(lines shown)' : '(included in totals)'}</span>
          <div className="chip-row">
            {CHART_TYPES.map((t) => (
              <button key={t} className={types.has(t) ? 'chip on' : 'chip'} onClick={() => toggleType(t)}>
                {types.has(t) ? '✓ ' : ''}{t}
              </button>
            ))}
          </div>
        </div>
        <div className="control-block">
          <span className="control-label">Currency</span>
          <div className="mode-row">
            <button className={currency === 'MVR' ? 'pill active' : 'pill'} onClick={() => setCurrency('MVR')}>MVR</button>
            <button className={currency === 'USD' ? 'pill active' : 'pill'} onClick={() => setCurrency('USD')}>USD</button>
          </div>
        </div>
      </div>

      <div className="control-block">
        <span className="control-label">Atolls ({selectedAtolls.size} shown)
          <button className="link-button" onClick={() => setAtolls(new Set(atollList.map((a) => a.code)))}>All</button>
          <button className="link-button" onClick={() => setAtolls(new Set())}>None</button>
          <button className="link-button" onClick={() => setAtolls(new Set(topFiveCodes))}>Top 5</button>
        </span>
        <div className="chip-row atoll-chips">
          {atollList.map((a) => (
            <button key={a.code} className={selectedAtolls.has(a.code) ? 'chip on' : 'chip'} onClick={() => toggleAtoll(a.code)}>
              {a.code}
            </button>
          ))}
        </div>
      </div>

      <div ref={chartRef} className="echart" />
    </section>
  );
}

function fmtAxis(v, currency) {
  const abs = Math.abs(v);
  const sym = currency === 'USD' ? '$' : 'MVR ';
  if (abs >= 1e9) return `${sym}${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sym}${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sym}${(v / 1e3).toFixed(0)}K`;
  return `${sym}${Math.round(v)}`;
}

export default App;
