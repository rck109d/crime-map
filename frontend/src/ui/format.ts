const whole = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const oneDecimal = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const fmt = (n: number) => whole.format(n);
/** 1,284 stays whole; 12,900 becomes 12.9K. */
export const fmtCompact = (n: number) => (Math.abs(n) < 10_000 ? whole.format(n) : compact.format(n));
export const fmt1 = (n: number) => oneDecimal.format(n);
export const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
