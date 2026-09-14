import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../render.js';
import { SourcePane } from '../../src/components/source/SourcePane.js';
import { fx } from '../msw/fixtures.js';
import { state } from '../msw/handlers.js';

describe('SourcePane', () => {
  it('shows an empty state with an edit call-to-action for editors when no source exists', async () => {
    renderWithProviders(<SourcePane documentId={fx.docBrowsing.id} canEdit />);
    expect(await screen.findByText('אין עדיין מסמך מקור לפריט זה')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'צור מסמך מקור' })).toHaveAttribute(
      'href',
      `/edit/${fx.docBrowsing.id}/source`,
    );
  });

  it('renders sanitized html read-only and offers raw download when a revision exists', async () => {
    state.sourceDocs.set(fx.docBrowsing.id, {
      html: '<h2>מקור</h2><p>גוף</p>',
      text: 'מקור\nגוף',
      version: 3,
      etag: 'e3',
      versions: [],
      // The revision arrives on `GET /documents/:id/source`, not as a prop nobody passed.
      latestRevisionId: 'r1',
    });
    renderWithProviders(<SourcePane documentId={fx.docBrowsing.id} canEdit={false} sourceId="s1" />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'מקור' })).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: 'ערוך מקור' })).toBeNull();
    expect(screen.getByRole('link', { name: 'הורד קובץ מקור' })).toHaveAttribute(
      'href',
      expect.stringContaining('/sources/s1/revisions/r1/raw'),
    );
    expect(screen.getByText(/גרסת מקור 3/)).toBeInTheDocument();
  });
});
