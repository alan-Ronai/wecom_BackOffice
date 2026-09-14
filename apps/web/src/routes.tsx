import { Navigate, type RouteObject } from 'react-router-dom';
import { Shell } from './components/shell/Shell.js';
import { RequireAuth } from './components/auth/RequireAuth.js';
import { LoginPage } from './components/auth/LoginPage.js';
import { LibraryPage } from './components/library/LibraryPage.js';
import { FieldsPage } from './components/library/FieldsPage.js';
import { BlocksPage } from './components/library/BlocksPage.js';
import { ScriptsPage } from './components/library/ScriptsPage.js';
import { ArticlePage } from './components/article/ArticlePage.js';
import { EditorPage } from './components/editor/EditorPage.js';
import { HistoryPage } from './components/history/HistoryPage.js';
import { TrashPage } from './components/trash/TrashPage.js';
import { ReviewsPage } from './components/review/ReviewsPage.js';
import { NotificationsPage } from './components/notifications/NotificationsPage.js';
import { SourcesPage } from './components/sources/SourcesPage.js';
import { DataPage } from './components/data/DataPage.js';
import { GraphPage } from './components/graph/GraphPage.js';
import { FieldPage } from './components/library/FieldPage.js';
import { BlockPage } from './components/library/BlockPage.js';
import { DashboardsPage } from './components/dashboards/DashboardsPage.js';
import { SyncQueuePage } from './components/sync/SyncQueuePage.js';
import { ParityPage } from './components/sync/ParityPage.js';
import { ConflictPage } from './components/sync/ConflictPage.js';
import { AdminLayout } from './components/admin/AdminLayout.js';
import { UsersPage } from './components/admin/UsersPage.js';
import { RolesPage } from './components/admin/RolesPage.js';
import { GroupsMapPage } from './components/admin/GroupsMapPage.js';
import { SessionsPage } from './components/admin/SessionsPage.js';
import { AuditPage } from './components/admin/AuditPage.js';
import { IdentityPage } from './components/admin/IdentityPage.js';
import { ConnectorsPage } from './components/admin/ConnectorsPage.js';
import { ConnectorWizard } from './components/admin/ConnectorWizard.js';
import { SystemPage } from './components/admin/SystemPage.js';
import { TopicPage } from './components/taxonomy/TopicPage.js';

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
      { path: 'scripts', element: <ScriptsPage /> },
      { path: 'doc/:id', element: <ArticlePage /> },
      { path: 'doc/:id/:step', element: <ArticlePage /> },
      { path: 'topic/:id', element: <TopicPage /> },
      { path: 'edit/:id', element: <EditorPage /> },
      { path: 'history', element: <HistoryPage /> },
      { path: 'history/:id', element: <HistoryPage /> },
      { path: 'history/:id/:v', element: <HistoryPage /> },
      { path: 'trash', element: <TrashPage /> },
      { path: 'reviews', element: <ReviewsPage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'sources', element: <SourcesPage /> },
      { path: 'sources/:id', element: <SourcesPage /> },
      { path: 'data', element: <DataPage /> },
      { path: 'data/:sourceId', element: <DataPage /> },
      { path: 'graph', element: <GraphPage /> },
      { path: 'dashboards', element: <DashboardsPage /> },
      { path: 'sync', element: <SyncQueuePage /> },
      { path: 'sync/parity', element: <ParityPage /> },
      { path: 'sync/conflicts/:id', element: <ConflictPage /> },
      {
        path: 'admin',
        element: <AdminLayout />,
        children: [
          { index: true, element: <Navigate to="users" replace /> },
          { path: 'users', element: <UsersPage /> },
          { path: 'roles', element: <RolesPage /> },
          { path: 'groups', element: <GroupsMapPage /> },
          { path: 'sessions', element: <SessionsPage /> },
          { path: 'audit', element: <AuditPage /> },
          { path: 'identity', element: <IdentityPage /> },
          { path: 'connectors', element: <ConnectorsPage /> },
          // `new` before `:id`, or the wizard would try to load a connector called "new".
          { path: 'connectors/new', element: <ConnectorWizard /> },
          { path: 'connectors/:id', element: <ConnectorWizard /> },
          { path: 'system', element: <SystemPage /> },
        ],
      },
      { path: '*', element: <Navigate to="/library" replace /> },
    ],
  },
];
