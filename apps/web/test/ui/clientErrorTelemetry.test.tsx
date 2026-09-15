/**
 * M2 — a crash report that names the document, the route and the throw.
 *
 * `client_error` rows were `{ kind, at }` and nothing else, so the usage table could say a screen
 * blanked and never which one. `telemetry_events.document_id` was there all along; the boundary
 * knows the route it guards; nobody joined the two. `0043_telemetry_client_error.js` then adds the
 * `path` and `message` columns the table never had.
 *
 * The id has to survive a foreign key into `documents`, so the route path is matched, not trusted:
 * `/edit/new` is a route with no document behind it, and a crash report that itself fails to
 * insert is worse than one with a column left null.
 *
 * The other half of this file is about what is *not* sent. A `message` is not a designed field —
 * it is whatever string the throwing code interpolated — and this table is readable by anyone with
 * `analytics.read`, so the assertions below are deliberately written as exact payloads: a new key
 * appearing on a crash report should fail a test, not ship.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  ErrorBoundary,
  RouteBoundary,
  documentIdFromPath,
  safeErrorMessage,
} from '../../src/components/ui/ErrorBoundary.js';
import { stage45State } from '../msw/stage45.js';
import { D_BROWSING } from '../msw/fixtures.js';

/** Any id that is not the one already on the row — a step's, a user's, a card the KB has since dropped. */
const FOREIGN_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

function Boom({ message = 'שלב פגום' }: { message?: string }): never {
  const e = new Error(message);
  // A real throw carries a stack. Nothing below may ever contain a frame from it.
  e.stack = `Error: ${message}\n    at Boom (/assets/index-9f3c.js:1:2)`;
  throw e;
}

const crashAt = (path: string, pattern: string, message?: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path={pattern}
          element={
            <RouteBoundary>
              <Boom message={message} />
            </RouteBoundary>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

const clientErrors = () => stage45State.telemetry.filter((e) => e.kind === 'client_error');

describe('documentIdFromPath', () => {
  it('reads the id out of the reading and editing routes', () => {
    expect(documentIdFromPath(`/doc/${D_BROWSING}`)).toBe(D_BROWSING);
    expect(documentIdFromPath(`/doc/${D_BROWSING}/s3`)).toBe(D_BROWSING);
    expect(documentIdFromPath(`/edit/${D_BROWSING}`)).toBe(D_BROWSING);
  });

  it('refuses anything that is not an id, so the insert cannot fail on a foreign key', () => {
    expect(documentIdFromPath('/edit/new')).toBeUndefined();
    expect(documentIdFromPath('/library')).toBeUndefined();
    expect(documentIdFromPath('shell')).toBeUndefined();
    expect(documentIdFromPath('/doc/not-a-uuid')).toBeUndefined();
  });
});

describe('safeErrorMessage', () => {
  it('replaces an address and a foreign id, and keeps the document already on the row', () => {
    expect(safeErrorMessage('no mailbox for dana@ronai.example', undefined)).toBe('no mailbox for [email]');
    expect(safeErrorMessage(`no step ${FOREIGN_ID}`, D_BROWSING)).toBe('no step [id]');
    expect(safeErrorMessage(`missing ${D_BROWSING}`, D_BROWSING)).toBe(`missing ${D_BROWSING}`);
    // Case is not a hiding place: the same id in either case is still the same id.
    expect(safeErrorMessage(`missing ${D_BROWSING.toUpperCase()}`, D_BROWSING)).toBe(
      `missing ${D_BROWSING.toUpperCase()}`,
    );
  });

  it('truncates past the contract cap, so the API answers 204 and not 400', () => {
    const out = safeErrorMessage('x'.repeat(5000));
    expect(out).toHaveLength(1000);
    expect(out.endsWith('…')).toBe(true);
    // A redaction is never left cut in half: truncation runs after it.
    const long = safeErrorMessage('dana@ronai.example '.repeat(200));
    expect(long).not.toMatch(/@/);
  });
});

describe('client_error telemetry', () => {
  it('sends exactly kind, at, documentId, path and message — nothing else', async () => {
    crashAt(`/doc/${D_BROWSING}`, '/doc/:id', 'שלב פגום');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await waitFor(() => expect(clientErrors()).toHaveLength(1));
    const ev = clientErrors()[0]!;
    expect(Object.keys(ev).sort()).toEqual(['at', 'documentId', 'kind', 'message', 'path']);
    expect(ev).toMatchObject({
      kind: 'client_error',
      documentId: D_BROWSING,
      path: `/doc/${D_BROWSING}`,
      message: 'שלב פגום',
    });
    expect(new Date(ev.at!).toString()).not.toBe('Invalid Date');
    // The message, not the stack.
    expect(ev.message).not.toMatch(/\.js:|\bat Boom\b/);
  });

  it('leaves the column null where there is no document — a library crash is not a document crash', async () => {
    crashAt('/library', '/library');
    await waitFor(() => expect(clientErrors()).toHaveLength(1));
    expect(clientErrors()[0]!.documentId).toBeUndefined();
    expect(clientErrors()[0]!.path).toBe('/library');
  });

  it('sends the pathname only — never the query string or the hash the agent was on', async () => {
    render(
      <MemoryRouter initialEntries={['/library?q=%D7%A1%D7%95%D7%93%D7%99#step-4']}>
        <Routes>
          <Route
            path="/library"
            element={
              <RouteBoundary>
                <Boom />
              </RouteBoundary>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(clientErrors()).toHaveLength(1));
    expect(clientErrors()[0]!.path).toBe('/library');
  });

  it('redacts an address the throwing code interpolated, and an id that is not the document', async () => {
    crashAt(
      `/doc/${D_BROWSING}`,
      '/doc/:id',
      `owner dana@ronai.example is missing step ${FOREIGN_ID} of ${D_BROWSING}`,
    );
    await waitFor(() => expect(clientErrors()).toHaveLength(1));
    expect(clientErrors()[0]!.message).toBe(`owner [email] is missing step [id] of ${D_BROWSING}`);
  });

  it('a boundary named for something other than a route still reports the route', async () => {
    // The shell and the three overlay boundaries pass `where="shell"`/`"palette"`/… — a name, not
    // a path. Before M2 the document was read out of `where`, so those four reported nothing.
    render(
      <MemoryRouter initialEntries={[`/doc/${D_BROWSING}`]}>
        <ErrorBoundary where="shell">
          <Boom message="נפילה" />
        </ErrorBoundary>
      </MemoryRouter>,
    );
    await waitFor(() => expect(clientErrors()).toHaveLength(1));
    expect(clientErrors()[0]).toMatchObject({
      path: `/doc/${D_BROWSING}`,
      documentId: D_BROWSING,
      message: 'נפילה',
    });
  });
});
