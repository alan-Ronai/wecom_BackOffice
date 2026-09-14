import { Suspense, lazy, type ComponentType, type ReactElement } from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';
import { Shell } from './components/shell/Shell.js';
import { RequireAuth } from './components/auth/RequireAuth.js';
import { LoginPage } from './components/auth/LoginPage.js';
import { LibraryPage } from './components/library/LibraryPage.js';
import { FieldsPage } from './components/library/FieldsPage.js';
import { BlocksPage } from './components/library/BlocksPage.js';
import { ArticlePage } from './components/article/ArticlePage.js';
import { EditorPage } from './components/editor/EditorPage.js';
import { HistoryPage } from './components/history/HistoryPage.js';
import { TrashPage } from './components/trash/TrashPage.js';
import { ReviewsPage } from './components/review/ReviewsPage.js';
import { NotificationsPage } from './components/notifications/NotificationsPage.js';
import { FieldPage } from './components/library/FieldPage.js';
import { BlockPage } from './components/library/BlockPage.js';
import { TopicPage } from './components/taxonomy/TopicPage.js';

/**
 * ## What is in the entry chunk, and why
 *
 * Everything above is the path an agent takes on a call: log in, find the document, read it,
 * maybe fix a step, check the history, look at the review queue. It ships in the first paint
 * because waiting on a chunk while a customer is on the line is not a trade worth making for a
 * few kilobytes.
 *
 * Everything below is lazy. The graph carries a force layout and an SVG renderer; the dashboards
 * carry five hand-written charts; the admin console is nine screens most of these users will
 * never have permission to open; and the data explorer, sources and sync screens are operator
 * tools, reached deliberately. Before this split the production build was a single 600 kB chunk,
 * so opening the library on a call downloaded the entire admin console first.
 *
 * The boundary is drawn by *who opens it and when*, not by size — which is why `HistoryPage` and
 * `ReviewsPage` stay eager despite not being tiny, and `SourcesPage` goes lazy despite being
 * modest. A route an agent might reach mid-call is not somewhere to put a network round trip.
 */
const lazyRoute = (load: () => Promise<{ default: ComponentType }>) => {
  const C = lazy(load);
  return <C />;
};

/**
 * Named exports, wrapped so `lazy` gets the default export it requires.
 *
 * Written out per module rather than through a helper taking a module path, because Vite's
 * analyser has to see a literal `import()` specifier to split on it at all — a dynamic one
 * silently produces no chunk, which is the failure mode this whole change exists to fix.
 */
const DataPage = () => import('./components/data/DataPage.js').then((m) => ({ default: m.DataPage }));
const GraphPage = () => import('./components/graph/GraphPage.js').then((m) => ({ default: m.GraphPage }));
const SourcesPage = () =>
  import('./components/sources/SourcesPage.js').then((m) => ({ default: m.SourcesPage }));
const DashboardsPage = () =>
  import('./components/dashboards/DashboardsPage.js').then((m) => ({ default: m.DashboardsPage }));
const SyncQueuePage = () =>
  import('./components/sync/SyncQueuePage.js').then((m) => ({ default: m.SyncQueuePage }));
const ParityPage = () => import('./components/sync/ParityPage.js').then((m) => ({ default: m.ParityPage }));
const ConflictPage = () =>
  import('./components/sync/ConflictPage.js').then((m) => ({ default: m.ConflictPage }));
const AdminLayout = () =>
  import('./components/admin/AdminLayout.js').then((m) => ({ default: m.AdminLayout }));
const UsersPage = () => import('./components/admin/UsersPage.js').then((m) => ({ default: m.UsersPage }));
const RolesPage = () => import('./components/admin/RolesPage.js').then((m) => ({ default: m.RolesPage }));
const GroupsMapPage = () =>
  import('./components/admin/GroupsMapPage.js').then((m) => ({ default: m.GroupsMapPage }));
const SessionsPage = () =>
  import('./components/admin/SessionsPage.js').then((m) => ({ default: m.SessionsPage }));
const AuditPage = () => import('./components/admin/AuditPage.js').then((m) => ({ default: m.AuditPage }));
const IdentityPage = () =>
  import('./components/admin/IdentityPage.js').then((m) => ({ default: m.IdentityPage }));
const ConnectorsPage = () =>
  import('./components/admin/ConnectorsPage.js').then((m) => ({ default: m.ConnectorsPage }));
const ConnectorWizard = () =>
  import('./components/admin/ConnectorWizard.js').then((m) => ({ default: m.ConnectorWizard }));
const SystemPage = () => import('./components/admin/SystemPage.js').then((m) => ({ default: m.SystemPage }));

/**
 * Wave 4. `TopicPage` is eager with the rest of the reading path — the sidebar's world rows open
 * it mid-call. The three below are deliberate destinations: the source editor is a writing tool,
 * the feedback queue and the usage analytics are an editor's or a lead's screen, and the taxonomy
 * admin lives behind the admin console's own gate.
 */
const SourceEditPage = () =>
  import('./components/source/SourceEditPage.js').then((m) => ({ default: m.SourceEditPage }));
const FeedbackPage = () =>
  import('./components/feedback/FeedbackPage.js').then((m) => ({ default: m.FeedbackPage }));
/** The analytics tab is the same module with one prop, so it shares the chunk. */
const FeedbackAnalyticsPage = () =>
  import('./components/feedback/FeedbackPage.js').then((m) => ({
    default: () => <m.FeedbackPage tab="analytics" />,
  }));
const AnalyticsPage = () =>
  import('./components/analytics/AnalyticsPage.js').then((m) => ({ default: m.AnalyticsPage }));
const TaxonomyPage = () =>
  import('./components/admin/TaxonomyPage.js').then((m) => ({ default: m.TaxonomyPage }));

/** Wave 5 (V4a): the agent's learning screens are reached deliberately, not mid-call. */
const MyLearningPage = () =>
  import('./components/learning/MyLearningPage.js').then((m) => ({ default: m.MyLearningPage }));
const AssignmentPage = () =>
  import('./components/learning/AssignmentPage.js').then((m) => ({ default: m.AssignmentPage }));

/**
 * Wave 5 (V4b). Editor tooling, so lazy: the learning manager and its builders are a writing
 * surface, and the gaps queue is a lead's weekly screen — neither is somewhere an agent lands
 * mid-call.
 */
const LearningManagePage = () =>
  import('./components/learning/manage/LearningManagePage.js').then((m) => ({
    default: m.LearningManagePage,
  }));
const LearningItemEditor = () =>
  import('./components/learning/manage/LearningItemEditor.js').then((m) => ({
    default: m.LearningItemEditor,
  }));
const GapsPage = () => import('./components/gaps/GapsPage.js').then((m) => ({ default: m.GapsPage }));

/**
 * One boundary around the whole lazy area rather than one per route.
 *
 * `Suspense` resolves to the nearest boundary above the suspending component, so a single wrapper
 * inside `Shell`'s outlet would do — except that `AdminLayout` is itself lazy and renders its own
 * `<Outlet/>`, so a nested admin route suspends twice, and the fallback has to exist at both
 * levels. Wrapping each element keeps that from being something a future route has to know about.
 *
 * The fallback is the same `route-loading` the eager routes render while their queries settle, so
 * the chunk fetch is not visually a different kind of wait from the data fetch that follows it.
 */
const withSuspense = (element: ReactElement): ReactElement => (
  <Suspense fallback={<div className="route-loading">טוען…</div>}>{element}</Suspense>
);

const split = (load: () => Promise<{ default: ComponentType }>) => withSuspense(lazyRoute(load));

/** Routes mirror the legacy hashes one-to-one (spec §5). */
export const routeObjects: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    element: (
      <RequireAuth>
        <Shell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/library" replace /> },
      { path: 'library', element: <LibraryPage mode="library" /> },
      { path: 'library/:category', element: <LibraryPage mode="library" /> },
      { path: 'pinned', element: <LibraryPage mode="pinned" /> },
      { path: 'recent', element: <LibraryPage mode="recent" /> },
      { path: 'drafts', element: <LibraryPage mode="drafts" /> },
      { path: 'fields', element: <FieldsPage /> },
      // `:name` is a CRM field name, not an id — Hebrew, spaces and all — so callers encode it
      // into the path segment and the page decodes it.
      { path: 'fields/:name', element: <FieldPage /> },
      { path: 'blocks', element: <BlocksPage /> },
      { path: 'blocks/:id', element: <BlockPage /> },
      /**
       * A script has been a `docType: 'T'`, `kind: 'text'` document since the 0030 fold, and the
       * `/scripts*` adapter routes are gone — so the library filtered to that type *is* the
       * scripts page: it lists them, `/edit/:id` edits the body with the same editor, and
       * `POST /documents` creates them. The redirect keeps old links and bookmarks working.
       */
      { path: 'scripts', element: <Navigate to="/library?docType=T" replace /> },
      { path: 'doc/:id', element: <ArticlePage /> },
      { path: 'doc/:id/:step', element: <ArticlePage /> },
      { path: 'topic/:id', element: <TopicPage /> },
      { path: 'edit/:id', element: <EditorPage /> },
      { path: 'edit/:id/source', element: split(SourceEditPage) },
      { path: 'history', element: <HistoryPage /> },
      { path: 'history/:id', element: <HistoryPage /> },
      { path: 'history/:id/:v', element: <HistoryPage /> },
      { path: 'trash', element: <TrashPage /> },
      { path: 'reviews', element: <ReviewsPage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'sources', element: split(SourcesPage) },
      { path: 'sources/:id', element: split(SourcesPage) },
      { path: 'data', element: split(DataPage) },
      { path: 'data/:sourceId', element: split(DataPage) },
      { path: 'graph', element: split(GraphPage) },
      { path: 'dashboards', element: split(DashboardsPage) },
      { path: 'sync', element: split(SyncQueuePage) },
      { path: 'sync/parity', element: split(ParityPage) },
      { path: 'sync/conflicts/:id', element: split(ConflictPage) },
      // wave 4 (W3) — `analytics` before `:id`, or the drawer would try to load a report called
      // "analytics".
      { path: 'feedback', element: split(FeedbackPage) },
      { path: 'feedback/analytics', element: split(FeedbackAnalyticsPage) },
      { path: 'feedback/:id', element: split(FeedbackPage) },
      // W5. The sidebar entry that leads here is W6's mount; the route stands on its own.
      { path: 'analytics', element: split(AnalyticsPage) },
      // wave 5 — the agent's learning surface (V4a) and the manager's (V4b). Every `manage`
      // route precedes `learning/:assignmentId`, or the builder would load as an assignment id.
      { path: 'learning', element: split(MyLearningPage) },
      { path: 'learning/manage', element: split(LearningManagePage) },
      { path: 'learning/manage/new', element: split(LearningItemEditor) },
      { path: 'learning/manage/:id', element: split(LearningItemEditor) },
      { path: 'learning/:assignmentId', element: split(AssignmentPage) },
      { path: 'gaps', element: split(GapsPage) },
      {
        path: 'admin',
        element: split(AdminLayout),
        children: [
          { index: true, element: <Navigate to="users" replace /> },
          { path: 'users', element: split(UsersPage) },
          { path: 'roles', element: split(RolesPage) },
          { path: 'groups', element: split(GroupsMapPage) },
          { path: 'sessions', element: split(SessionsPage) },
          { path: 'audit', element: split(AuditPage) },
          { path: 'identity', element: split(IdentityPage) },
          { path: 'connectors', element: split(ConnectorsPage) },
          // `new` before `:id`, or the wizard would try to load a connector called "new".
          { path: 'connectors/new', element: split(ConnectorWizard) },
          { path: 'connectors/:id', element: split(ConnectorWizard) },
          { path: 'taxonomy', element: split(TaxonomyPage) },
          { path: 'system', element: split(SystemPage) },
        ],
      },
      { path: '*', element: <Navigate to="/library" replace /> },
    ],
  },
];
