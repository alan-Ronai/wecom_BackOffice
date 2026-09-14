import type pg from 'pg';
import { PERMISSIONS } from '@wecom/shared';

export interface TestUser {
  id: string;
  header: string;
  name: string;
}

export async function makeUser(
  pool: pg.Pool,
  o: { name?: string; perms?: readonly string[]; scopes?: string[] | null } = {},
): Promise<TestUser> {
  const name = o.name ?? 'בודק';
  const r = await pool.query(
    `insert into users(subject, source, email, display_name, initials) values ($1,'local',$2,$3,$4) returning id`,
    [crypto.randomUUID(), `${crypto.randomUUID()}@test.local`, name, 'ב'],
  );
  const id: string = r.rows[0].id;
  return {
    id,
    header: asciiJson({
      id,
      displayName: name,
      permissions: o.perms ?? [...PERMISSIONS],
      categoryScopes: o.scopes ?? null,
      worldScopes: o.scopes ?? null,
    }),
    name,
  };
}

/** Header values must be a ByteString, so Hebrew names are \uXXXX-escaped (JSON.parse decodes them). */
const asciiJson = (v: unknown) =>
  JSON.stringify(v).replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

export const auth = (u: { header: string }) => ({ 'x-test-user': u.header });

export const D1 = '11111111-1111-4111-8111-111111111111';

export const minimalStructure = {
  phases: [
    {
      id: 'p1',
      label: 'שלב 1 – מסנן',
      steps: [
        {
          key: 's1',
          num: '1',
          title: 'בדיקת חסימת גלישה בארץ',
          actions: [{ id: 'a1', text: 'פתח CRM ↗ שדה "גלישה בארץ"' }],
          outcomes: [{ kind: 'ok', text: '✓ לא חסום – המשך לשלב 2', goto: 's2' }],
        },
        {
          key: 's2',
          num: '2',
          title: 'בדיקת סיום חבילה',
          actions: [{ id: 'a1', text: 'אזור אישי ↗ "השימושים שלי"' }],
          outcomes: [{ kind: 'ok', text: '✓ סיום' }],
        },
      ],
    },
  ],
};
