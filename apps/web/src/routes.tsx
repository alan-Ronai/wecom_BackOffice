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
import { SourcesPage } from './components/sources/SourcesPage.js';
import { DataPage } from './components/data/DataPage.js';
import { AdminLayout } from './components/admin/AdminLayout.js';
import { UsersPage } from './components/admin/UsersPage.js';
import { RolesPage } from './components/admin/RolesPage.js';
import { GroupsMapPage } from './components/admin/GroupsMapPage.js';
import { SessionsPage } from './components/admin/SessionsPage.js';
import { AuditPage } from './components/admin/AuditPage.js';
import { SystemPage } from './components/admin/SystemPage.js';

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
      { path: 'blocks', element: <BlocksPage /> },
      { path: 'doc/:id', element: <ArticlePage /> },
      { path: 'doc/:id/:step', element: <ArticlePage /> },
      { path: 'edit/:id', element: <EditorPage /> },
      { path: 'history', element: <HistoryPage /> },
      { path: 'history/:id', element: <HistoryPage /> },
      { path: 'history/:id/:v', element: <HistoryPage /> },
      { path: 'trash', element: <TrashPage /> },
      { path: 'sources', element: <SourcesPage /> },
      { path: 'sources/:id', element: <SourcesPage /> },
      { path: 'data', element: <DataPage /> },
      { path: 'data/:sourceId', element: <DataPage /> },
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
          { path: 'system', element: <SystemPage /> },
        ],
      },
      { path: '*', element: <Navigate to="/library" replace /> },
    ],
  },
];
