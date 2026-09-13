export {
  fmt,
  fmtPlain,
  stripFmt,
  wordDiff,
  similarity,
  stepText,
  escapeHtml,
  crmChip,
  crmIn,
  detectLinks,
  detectFieldRefs,
} from '@wecom/shared';
export type { DocRef, FieldInfo, FieldStatus } from '@wecom/shared';

const HE_MONTHS = [
  'ינואר',
  'פברואר',
  'מרץ',
  'אפריל',
  'מאי',
  'יוני',
  'יולי',
  'אוגוסט',
  'ספטמבר',
  'אוקטובר',
  'נובמבר',
  'דצמבר',
];

type DateLike = string | number | Date;

const parse = (v: DateLike): Date =>
  new Date(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v + 'T12:00:00' : v);

/** Port of legacy KB.fmtDate. */
export const fmtDate = (v: DateLike, o: { month?: boolean } = {}): string => {
  const d = parse(v);
  if (isNaN(d.getTime())) return '';
  return o.month
    ? `${HE_MONTHS[d.getMonth()]} ${d.getFullYear()}`
    : `${d.getDate()} ${HE_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

/** Port of legacy KB.fmtTime. */
export const fmtTime = (v: DateLike): string => {
  const d = parse(v);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** Port of legacy KB.ago. */
export const ago = (v: DateLike): string => {
  const d0 = parse(v);
  if (isNaN(d0.getTime())) return '';
  const s = Math.max(0, (Date.now() - d0.getTime()) / 1000);
  if (s < 5) return 'עכשיו';
  if (s < 60) return `לפני ${Math.floor(s)} שנ׳`;
  const m = s / 60;
  if (m < 60) return `לפני ${Math.floor(m)} דק׳`;
  const h = m / 60;
  if (h < 24) return `לפני ${Math.floor(h)} שעות`;
  const d = h / 24;
  if (d < 2) return 'אתמול';
  if (d < 30) return `לפני ${Math.floor(d)} ימים`;
  return fmtDate(v);
};

/** Port of legacy KB.inDays. */
export const inDays = (v: DateLike): string => {
  const d = Math.ceil((parse(v).getTime() - Date.now()) / 864e5);
  return d <= 0 ? 'היום' : d === 1 ? 'מחר' : `בעוד ${d} ימים`;
};

export const copy = (text: string): Promise<void> =>
  navigator.clipboard?.writeText ? navigator.clipboard.writeText(text) : Promise.resolve(undefined);

export function download(name: string, data: string, type = 'application/json'): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}
