export interface FacetValue {
  wave: 'all' | 1 | 2 | 3;
  flag: null | 'hh' | 'month' | 'partial' | 'changed';
}

/** Port of the legacy facet row: wave buttons plus the three flags. */
export function Facets({ value, onChange }: { value: FacetValue; onChange: (v: FacetValue) => void }) {
  const fac = (label: string, on: boolean, next: () => FacetValue, dot?: boolean) => (
    <span
      key={label}
      className={'facet' + (on ? ' on' : '')}
      role="button"
      tabIndex={0}
      onClick={() => onChange(next())}
    >
      {dot ? <span className="dot" /> : null}
      {label}
    </span>
  );
  return (
    <div className="facets">
      {fac('הכל', value.wave === 'all', () => ({ ...value, wave: 'all' }))}
      {([1, 2, 3] as const).map((w) =>
        fac(`גל ${w}`, value.wave === w, () => ({ ...value, wave: value.wave === w ? 'all' : w })),
      )}
      <span className="vsep" />
      {fac(
        'שכיח מאוד',
        value.flag === 'hh',
        () => ({ ...value, flag: value.flag === 'hh' ? null : 'hh' }),
        true,
      )}
      {fac('עודכן החודש', value.flag === 'month', () => ({
        ...value,
        flag: value.flag === 'month' ? null : 'month',
      }))}
      {fac('מסמך חלקי', value.flag === 'partial', () => ({
        ...value,
        flag: value.flag === 'partial' ? null : 'partial',
      }))}
      {/* 6a: "changed" is per user — compared against the last-seen map in preferences, not
          against a fixed window like "עודכן החודש" next to it. */}
      {fac('השתנה מאז שצפיתי', value.flag === 'changed', () => ({
        ...value,
        flag: value.flag === 'changed' ? null : 'changed',
      }))}
    </div>
  );
}
