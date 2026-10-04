/** "3 min", "5 h", "2 d" — formato compacto estilo Instagram. */
export function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'ahora';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d`;
  return `${Math.floor(days / 7)} sem`;
}

export function plural(n: number, singular: string, pluralForm: string): string {
  return `${n.toLocaleString('es-CO')} ${n === 1 ? singular : pluralForm}`;
}
