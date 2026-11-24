/**
 * Gaussian-weighted moving average, the smoothing the original atl-pd-data
 * tool used for its daily-crime graphs: each day is the weighted mean of its
 * neighbours with weight exp(-(distance / radius)^2 / 2).
 *
 * Weights are normalized over the days that exist, so the result stays in
 * "incidents per day" and the ends of the series (and the edges of a gap in
 * the data) are not dragged toward zero.
 */
export function gaussianSmooth(
  values: ArrayLike<number>,
  radius: number,
  /** Per day, 0 where there is no data at all: such days come out NaN and are not averaged in. */
  covered?: ArrayLike<number>,
): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  if (radius <= 0) {
    for (let i = 0; i < n; i++) out[i] = covered && !covered[i] ? NaN : values[i];
    return out;
  }
  const reach = Math.ceil(radius * 3);
  const weights = new Float64Array(reach + 1);
  for (let d = 0; d <= reach; d++) weights[d] = Math.exp(-((d / radius) ** 2) / 2);
  for (let i = 0; i < n; i++) {
    if (covered && !covered[i]) {
      out[i] = NaN;
      continue;
    }
    let sum = 0;
    let wsum = 0;
    const lo = Math.max(0, i - reach);
    const hi = Math.min(n - 1, i + reach);
    for (let j = lo; j <= hi; j++) {
      if (covered && !covered[j]) continue;
      const w = weights[Math.abs(j - i)];
      sum += values[j] * w;
      wsum += w;
    }
    out[i] = sum / wsum;
  }
  return out;
}

/** Tick values for an axis from 0 to at least `max`, on round numbers. */
export function niceTicks(max: number, target = 4): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / target;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? 10 * pow;
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}
