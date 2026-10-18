const pesos = new Intl.NumberFormat("es-PE", {
  style: "currency",
  currency: "PEN",
  maximumFractionDigits: 0,
});

/** Soles peruanos, sin decimales. Los negativos usan el signo menos tipográfico. */
export function soles(valor: number): string {
  const texto = pesos.format(Math.abs(valor));
  return valor < 0 ? `−${texto}` : texto;
}
