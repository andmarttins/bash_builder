export type SubmissionCursorPage = {
  page: number;
  cursor: string | null;
};

/** Resolves a numbered UI action to the opaque cursor that begins that page. */
export function resolveSubmissionCursorPage(input: {
  requestedPage: number;
  currentPage: number;
  nextCursor: string | null;
  pageCursors: Array<string | null>;
}): SubmissionCursorPage {
  const page = Math.max(1, Math.floor(input.requestedPage));
  if (page === 1) return { page, cursor: null };
  if (page === input.currentPage + 1) {
    if (input.nextCursor) return { page, cursor: input.nextCursor };
    return { page: input.currentPage, cursor: input.pageCursors[input.currentPage - 1] ?? null };
  }
  return { page, cursor: input.pageCursors[page - 1] ?? null };
}
