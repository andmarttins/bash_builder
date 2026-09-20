import { describe, expect, it } from 'vitest';
import { resolveSubmissionCursorPage } from './submission-pagination.js';

describe('resolveSubmissionCursorPage', () => {
  it('uses the server cursor for the next page and preserves earlier cursors', () => {
    expect(resolveSubmissionCursorPage({ requestedPage: 2, currentPage: 1, nextCursor: 'cursor-page-2', pageCursors: [null] })).toEqual({ page: 2, cursor: 'cursor-page-2' });
    expect(resolveSubmissionCursorPage({ requestedPage: 2, currentPage: 3, nextCursor: 'cursor-page-4', pageCursors: [null, 'cursor-page-2', 'cursor-page-3'] })).toEqual({ page: 2, cursor: 'cursor-page-2' });
  });

  it('refreshes the current page without advancing it and resets filters to page one', () => {
    expect(resolveSubmissionCursorPage({ requestedPage: 3, currentPage: 3, nextCursor: 'cursor-page-4', pageCursors: [null, 'cursor-page-2', 'cursor-page-3'] })).toEqual({ page: 3, cursor: 'cursor-page-3' });
    expect(resolveSubmissionCursorPage({ requestedPage: 0, currentPage: 3, nextCursor: 'cursor-page-4', pageCursors: [null, 'cursor-page-2', 'cursor-page-3'] })).toEqual({ page: 1, cursor: null });
  });

  it('does not advance or repeat the first page when the server has no next cursor', () => {
    expect(resolveSubmissionCursorPage({ requestedPage: 2, currentPage: 1, nextCursor: null, pageCursors: [null] })).toEqual({ page: 1, cursor: null });
  });
});
