/** SVG polyline `points` string from real price samples -- viewBox 0 0 72 20. */
export function sparklinePoints(prices: number[]): string {
  if (prices.length < 2) return "";
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  return prices
    .map((v, i) => {
      const x = (i * 72) / (prices.length - 1);
      const y = 20 - ((v - min) / span) * 17 - 1.5;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
