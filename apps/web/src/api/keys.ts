/** One factory for every TanStack Query key, so SSE invalidation and hooks can never drift. */
export const keys = {
  me: ['me'] as const,
  health: ['health'] as const,
  prefs: ['prefs'] as const,
  providers: ['providers'] as const,
  docs: (q: unknown = '*') => ['documents', q] as const,
  /** Ids of every pinned document — independent of which library page is loaded (I10). */
  pins: ['pins'] as const,
  doc: (id: string) => ['document', id] as const,
  related: (id: string) => ['related', id] as const,
  links: (id: string) => ['links', id] as const,
  notes: (id: string) => ['notes', id] as const,
  versions: (id: string) => ['versions', id] as const,
  version: (id: string, v: number) => ['version', id, v] as const,
  diff: (id: string, from: number, to: number) => ['diff', id, from, to] as const,
  draft: (id: string) => ['draft', id] as const,
  blocks: ['blocks'] as const,
  blockUsage: (id: string) => ['blockUsage', id] as const,
  fields: ['fields'] as const,
  fieldUsage: (n: string) => ['fieldUsage', n] as const,
  search: (q: string, types?: string) => ['search', q, types ?? ''] as const,
  trash: ['trash'] as const,
  sources: ['sources'] as const,
  revision: (id: string, rev: string) => ['revision', id, rev] as const,
  suggestions: (q: unknown = '*') => ['suggestions', q] as const,
  /* stage 4 — connected data */
  graph: (q: unknown = '*') => ['graph', q] as const,
  impact: (nodeId: string) => ['impact', nodeId] as const,
  fieldPage: (name: string) => ['fieldPage', name] as const,
  blockPage: (id: string) => ['blockPage', id] as const,
  dataFiles: ['dataFiles'] as const,
  dataPreview: (id: string, limit: number) => ['dataPreview', id, limit] as const,
  dashboards: ['dashboards'] as const,
  /* stage 4–5 (typed from the zod contract — see `src/api/stage45.ts`) */
  notifications: (q: unknown = '*') => ['notifications', q] as const,
  mentionable: (q: string) => ['mentionable', q] as const,
  comments: (id: string) => ['comments', id] as const,
  reviews: (q: unknown = '*') => ['reviews', q] as const,
  views: ['views'] as const,
  templates: ['templates'] as const,
  presence: (id: string) => ['presence', id] as const,
  /* wave 4 — taxonomy (W1) */
  worlds: (inactive = false) => ['worlds', inactive] as const,
  topics: (world: string) => ['topics', world] as const,
  topic: (id: string) => ['topic', id] as const,
  tags: (q = '') => ['tags', q] as const,
  /* wave 4 — source documents (W4) */
  source: (id: string) => ['source', id] as const,
  sourceVersions: (id: string) => ['sourceVersions', id] as const,
  sourceVersion: (id: string, v: number) => ['sourceVersion', id, v] as const,
  sourceDraft: (id: string) => ['sourceDraft', id] as const,
  /* wave 4 — W3 feedback (typed from the zod contract — see `src/api/hooks/feedback.ts`) */
  feedback: (q: unknown = '*') => ['feedback', q] as const,
  feedbackItem: (id: string) => ['feedback', 'item', id] as const,
  feedbackAnalytics: (q: unknown = '*') => ['feedback', 'analytics', q] as const,
  docFeedback: (id: string) => ['docFeedback', id] as const,
  /**
   * wave 5 — learning (V4a's learner keys and V4b's manager keys in one block). Every key starts
   * with `'learning'`, which is what lets one prefix invalidation drop the whole surface when a
   * `learning.*` event arrives over SSE.
   */
  learning: {
    my: ['learning', 'my'] as const,
    player: (assignmentId: string) => ['learning', 'player', assignmentId] as const,
    doc: (documentId: string) => ['learning', 'doc', documentId] as const,
    items: (q: unknown = '*') => ['learning', 'items', q] as const,
    item: (id: string) => ['learning', 'item', id] as const,
    versions: (id: string) => ['learning', 'versions', id] as const,
    completion: (id: string) => ['learning', 'completion', id] as const,
    dashboard: (world: string = '*') => ['learning', 'dashboard', world] as const,
    audienceOptions: ['learning', 'audienceOptions'] as const,
    changePreview: (documentId: string) => ['learning', 'changePreview', documentId] as const,
  },
  /* wave 5 — knowledge gaps (V4b) */
  gaps: (q: unknown = '*') => ['gaps', q] as const,
  admin: {
    users: (q: unknown = '*') => ['admin', 'users', q] as const,
    roles: ['admin', 'roles'] as const,
    groups: ['admin', 'groups'] as const,
    /** Under `admin.groups`, so saving the map also drops the search results built from it. */
    groupSearch: (q: string) => ['admin', 'groups', 'search', q] as const,
    sessions: ['admin', 'sessions'] as const,
    audit: (q: unknown = '*') => ['admin', 'audit', q] as const,
    auditEntry: (id: string) => ['admin', 'audit', 'entry', id] as const,
    matrix: ['admin', 'roles', 'matrix'] as const,
    identity: ['admin', 'identity'] as const,
    system: ['admin', 'system'] as const,
    /* wave 5 — V4b */
    workflow: ['admin', 'workflow'] as const,
  },
  /* wave 4 — usage analytics (W5) */
  analytics: {
    usage: (q: unknown = '*') => ['analytics', 'usage', q] as const,
    searchLog: (q: unknown = '*') => ['analytics', 'searchLog', q] as const,
  },
  connectors: ['connectors'] as const,
  connector: (id: string) => ['connectors', id] as const,
  connectorTypes: ['connectors', 'types'] as const,
  syncLinks: (q: unknown = '*') => ['sync', 'links', q] as const,
  conflict: (id: string) => ['sync', 'conflict', id] as const,
  /** Under `sync`, so creating a link or resolving a conflict invalidates the parity report too. */
  parity: (connectorId: string = '*') => ['sync', 'parity', connectorId] as const,
  /** Under `sync` too: resolving a conflict has to clear the article header's badge. */
  documentSyncState: (id: string) => ['sync', 'document', id] as const,
};
