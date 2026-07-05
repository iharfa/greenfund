export function propertyValue(properties, keys) {
  for (const key of keys) {
    if (properties && properties[key] !== undefined && properties[key] !== null && properties[key] !== '') {
      return String(properties[key]).trim();
    }
  }
  return '';
}

export function featureJoinKey(feature) {
  const props = feature?.properties || {};
  const direct = propertyValue(props, [
    'join_key',
    'JOIN_KEY',
    'Join_Key',
    'joinKey',
    'island_join_key',
    'spatial_key'
  ]);
  if (direct) return normalizeKey(direct);

  const atoll = propertyValue(props, [
    'atoll',
    'Atoll',
    'ATOLL',
    'atoll_code',
    'ATOLL_CODE',
    'AtollCode',
    'administrative_atoll'
  ]);
  const island = propertyValue(props, [
    'island',
    'Island',
    'ISLAND',
    'island_name',
    'ISLAND_NAME',
    'name',
    'Name',
    'NAME'
  ]);

  if (atoll && island) return normalizeKey(`${atoll}.${island}`);
  return '';
}

export function normalizeKey(key) {
  const [atoll, ...rest] = String(key || '').split('.');
  const island = rest.join('.');
  if (!atoll || !island) return String(key || '').trim();
  return `${normalizeAtoll(atoll)}.${normalizeIsland(island)}`;
}

export function normalizeAtoll(value) {
  const raw = String(value || '').trim();
  const lookup = {
    ha: 'HA',
    hdh: 'HDh',
    sh: 'Sh',
    n: 'N',
    r: 'R',
    b: 'B',
    lh: 'Lh',
    k: 'K',
    aa: 'AA',
    adh: 'ADh',
    v: 'V',
    m: 'M',
    f: 'F',
    dh: 'Dh',
    th: 'Th',
    l: 'L',
    ga: 'GA',
    gdh: 'GDh',
    gn: 'Gn',
    s: 'S'
  };
  return lookup[raw.toLowerCase()] || raw;
}

export function normalizeIsland(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function collectCoordinates(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Point') return [geometry.coordinates];
  if (geometry.type === 'MultiPoint' || geometry.type === 'LineString') return geometry.coordinates;
  if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') return geometry.coordinates.flat();
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat(2);
  if (geometry.type === 'GeometryCollection') {
    return geometry.geometries.flatMap((item) => collectCoordinates(item));
  }
  return [];
}

// Monotone chain convex hull over 2D points (axis-agnostic - works for screen pixels or lat/lng).
export function convexHull(points) {
  const pts = [...new Set(points.map((p) => p.join(',')))].map((s) => s.split(',').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length <= 2) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export function featureCentroid(feature) {
  const coords = collectCoordinates(feature.geometry).filter((coord) => Number.isFinite(coord[0]) && Number.isFinite(coord[1]));
  if (!coords.length) return [73.1, 3.2];
  const sum = coords.reduce((acc, coord) => [acc[0] + coord[0], acc[1] + coord[1]], [0, 0]);
  return [sum[0] / coords.length, sum[1] / coords.length];
}
