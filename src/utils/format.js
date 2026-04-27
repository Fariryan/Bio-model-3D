export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function titleCase(value) {
  return value
    .split(/[\s-]+/)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

export function formatPercent(value) {
  return `${Math.round(value)}%`;
}

export function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function sampleArray(items, count) {
  if (items.length <= count) {
    return items.slice();
  }

  const offset = Math.floor(Math.random() * items.length);
  return Array.from({ length: count }, (_, index) => {
    return items[(offset + index) % items.length];
  });
}

