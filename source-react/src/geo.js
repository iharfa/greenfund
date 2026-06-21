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

export function boundsForFeatures(features) {
  const coords = features.flatMap((feature) => collectCoordinates(feature.geometry));
  const valid = coords.filter((coord) => Number.isFinite(coord[0]) && Number.isFinite(coord[1]));
  if (!valid.length) return [72.4, -1, 74.2, 7.2];
  const xs = valid.map((coord) => coord[0]);
  const ys = valid.map((coord) => coord[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const padX = Math.max(0.2, (maxX - minX) * 0.08);
  const padY = Math.max(0.2, (maxY - minY) * 0.08);
  return [minX - padX, minY - padY, maxX + padX, maxY + padY];
}

export function createProjector(bounds, width, height, padding = 28) {
  const [minX, minY, maxX, maxY] = bounds;
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;

  return function project(coord) {
    const x = offsetX + (coord[0] - minX) * scale;
    const y = height - (offsetY + (coord[1] - minY) * scale);
    return [x, y];
  };
}

function pathForRing(ring, project) {
  return ring
    .map((coord, index) => {
      const [x, y] = project(coord);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ') + ' Z';
}

export function featurePath(feature, project) {
  const geometry = feature.geometry;
  if (!geometry) return '';
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.map((ring) => pathForRing(ring, project)).join(' ');
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates
      .flatMap((polygon) => polygon.map((ring) => pathForRing(ring, project)))
      .join(' ');
  }
  return '';
}

export function featureCentroid(feature) {
  const coords = collectCoordinates(feature.geometry).filter((coord) => Number.isFinite(coord[0]) && Number.isFinite(coord[1]));
  if (!coords.length) return [73.1, 3.2];
  const sum = coords.reduce((acc, coord) => [acc[0] + coord[0], acc[1] + coord[1]], [0, 0]);
  return [sum[0] / coords.length, sum[1] / coords.length];
}
