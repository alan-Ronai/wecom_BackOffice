/**
 * M2 — a crash report that names the document.
 *
 * `client_error` rows were `{ kind, at }` and nothing else, so the usage table could say a screen
 * blanked and never which one. `telemetry_events.document_id` was there all along; the boundary
 * knows the route it guards; nobody joined the two.
 *
 * The id has to survive a foreign key into `documents`, so the route path is matched, not trusted:
 * `/edit/new` is a route with no document behind it, and a crash report that itself fails to
 * insert is worse than one with a column left null.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RouteBoundary, documentIdFromPath } from '../../src/components/ui/ErrorBoundary.js';
import { stage45State } from '../msw/stage45.js';
import { D_BROWSING } from '../msw/fixtures.js';

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

function Boom(): never {
  throw new Error('שלב פגום');
}

const crashAt = (path: string, pattern: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path={pattern}
          element={
            <RouteBoundary>
              <Boom />
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

describe('client_error telemetry', () => {
  it('carries the document the agent was reading when the screen blanked', async () => {
    crashAt(`/doc/${D_BROWSING}`, '/doc/:id');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await waitFor(() => expect(clientErrors()).toHaveLength(1));
    expect(clientErrors()[0]!.documentId).toBe(D_BROWSING);
  });

  it('leaves the column null where there is no document — a library crash is not a document crash', async () => {
    crashAt('/library', '/library');
    await waitFor(() => expect(clientErrors()).toHaveLength(1));
    expect(clientErrors()[0]!.documentId).toBeUndefined();
  });
});
