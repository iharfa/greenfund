import { useEffect, useMemo, useState } from 'react';
import {
  categoryClassName,
  formatMoney,
  loadDashboardData,
  monthLabel
} from './data.js';
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

  return (
    <main className="app-shell">
      <section className="hero-card">
        <div>
          <div className="eyebrow"><span>{EMOJIS.join(' ')}</span> Green Fund spatial dashboard</div>
          <h1>Green Fund Money Map</h1>
          <p>
            Track where Maldives Green Fund spending flows by island, category, project, and month.
            The map uses parsed island joins from the workbook and accepts your islands repo GeoJSON.
          </p>
        </div>
        <div className="hero-money">
          <span>💰</span>
          <strong>{formatMoney(totals.totalSpend)}</strong>
          <small>{modeLabel(mode)} through {monthLabel(selectedMonth)}</small>
        </div>
      </section>

      <nav className="view-tabs">
        <button className={view === 'spending' ? 'tab active' : 'tab'} onClick={() => setView('spending')}>
          💸 Spending map
        </button>
        <button className={view === 'collection' ? 'tab active' : 'tab'} onClick={() => setView('collection')}>
          🟢 Collection &amp; redistribution
        </button>
      </nav>

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

      <footer className="data-disclaimer">
        <strong>Data notes</strong>
        <p>
          Green tax collection figures are reported by the Maldives Inland Revenue Authority (MIRA) at the
          atoll/city level only. MIRA is unable to provide data at a resolution that would allow individual
          taxpayers to be identified, so collection cannot be disaggregated below the atoll.
        </p>
        <p>
          Collection is keyed by atoll/city while green fund expenditure is keyed by island, then rolled up to
          atoll for comparison. Malé City raises green tax but has no green-fund spending mapped to it in the
          published expenditure data — such spending is likely recorded as national or unmapped — so its net-flow
          figure overstates the true redistribution. Net-flow and share comparisons are indicative, not audited
          reconciliations.
        </p>
      </footer>
    </main>
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
            <em>{formatMoney(row.amount)}</em>
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

      <section className="lower-grid">
        <CompositionChart composition={composition} balance={atollBalance} selectedAtoll={selectedAtoll} onSelect={setSelectedAtoll} />
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
              {atollBalance.map((row) => (
                <tr
                  key={row.atoll_code}
                  className={selectedAtoll === row.atoll_code ? 'row-selected' : ''}
                  onClick={() => setSelectedAtoll(row.atoll_code === selectedAtoll ? '' : row.atoll_code)}
                >
                  <td><b>{row.atoll_label}</b></td>
                  <td>{formatMoney(row.collection_mvr, false)}</td>
                  <td>{formatMoney(row.expenditure_mvr, false)}</td>
                  <td className={row.net_flow_mvr >= 0 ? 'net-pos' : 'net-neg'}>{formatMoney(row.net_flow_mvr, false)}</td>
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
  const sorted = [...rows].sort((a, b) => b.net_flow_mvr - a.net_flow_mvr);
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
  const sorted = [...rows].sort((a, b) => b.collection_share_pct - a.collection_share_pct);
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
    .slice(0, 12);
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

export default App;
