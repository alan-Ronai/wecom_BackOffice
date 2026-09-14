/**
 * TanStack Query bindings for the stage-4 ("connected data") routes in `../stage4.ts`.
 *
 * Invalidation is deliberately wide: the graph, the field page, the block page and the dashboards
 * are all *views over the same documents*, so a rename that rewrites 3 documents has to expire
 * every one of them, not just the page that triggered it.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { keys } from '../keys.js';
import * as s4 from '../stage4.js';
import type {
  Dashboard,
  DataFile,
  DataFilesResponse,
  DataPreview,
  FieldPage,
  FieldRenameBody,
  FieldRenameResult,
  GraphQuery,
  GraphResponse,
  ImpactResponse,
  PutMappingBody,
  ReimportResult,
  BlockPage,
} from '../stage4.js';

/* ── graph ────────────────────────────────────────────────────────────────── */

export const useGraph = (q: GraphQuery = {}): UseQueryResult<GraphResponse, Error> =>
  useQuery({ queryKey: keys.graph(q), queryFn: () => s4.getGraph(q), staleTime: 30_000 });

/** "What breaks if I delete this" — only fetched once a node is actually selected. */
export const useImpact = (nodeId: string | undefined): UseQueryResult<ImpactResponse, Error> =>
  useQuery({
    queryKey: keys.impact(nodeId ?? ''),
    enabled: !!nodeId,
    queryFn: () => s4.getImpact(nodeId!),
  });

/* ── field page ───────────────────────────────────────────────────────────── */

export const useFieldPage = (name: string | undefined): UseQueryResult<FieldPage, Error> =>
  useQuery({
    queryKey: keys.fieldPage(name ?? ''),
    enabled: !!name,
    queryFn: () => s4.getFieldPage(name!),
  });

/**
 * Rename with `updateReferences` rewrites every referencing document and publishes a version in
 * each, so the whole content surface is stale afterwards — including the *old* field page, whose
 * key no longer exists.
 */
export const useRenameField = (name: string) => {
  const qc = useQueryClient();
  return useMutation<FieldRenameResult, Error, FieldRenameBody>({
    mutationFn: (body) => s4.renameField(name, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.fields });
      void qc.invalidateQueries({ queryKey: ['fieldPage'] });
      void qc.invalidateQueries({ queryKey: ['fieldUsage'] });
      void qc.invalidateQueries({ queryKey: ['documents'] });
      void qc.invalidateQueries({ queryKey: ['graph'] });
      void qc.invalidateQueries({ queryKey: keys.dashboards });
    },
  });
};

/* ── block page ───────────────────────────────────────────────────────────── */

export const useBlockPage = (id: string | undefined): UseQueryResult<BlockPage, Error> =>
  useQuery({
    queryKey: keys.blockPage(id ?? ''),
    enabled: !!id,
    queryFn: () => s4.getBlockPage(id!),
  });

/* ── data explorer ────────────────────────────────────────────────────────── */

export const useDataFiles = (): UseQueryResult<DataFilesResponse, Error> =>
  useQuery({ queryKey: keys.dataFiles, queryFn: () => s4.getDataFiles() });

export const useDataPreview = (
  sourceId: string | undefined,
  limit = 25,
): UseQueryResult<DataPreview, Error> =>
  useQuery({
    queryKey: keys.dataPreview(sourceId ?? '', limit),
    enabled: !!sourceId,
    queryFn: () => s4.getDataPreview(sourceId!, { limit }),
  });

const invalidateData = (qc: ReturnType<typeof useQueryClient>) => {
  void qc.invalidateQueries({ queryKey: keys.dataFiles });
  void qc.invalidateQueries({ queryKey: ['dataPreview'] });
  void qc.invalidateQueries({ queryKey: keys.sources });
};

export const usePutMapping = (sourceId: string) => {
  const qc = useQueryClient();
  return useMutation<DataFile, Error, PutMappingBody>({
    mutationFn: (body) => s4.putMapping(sourceId, body),
    onSuccess: () => invalidateData(qc),
  });
};

/** Re-import runs the rows back through the pipeline, so the suggestion queue moves too. */
export const useReimport = (sourceId: string) => {
  const qc = useQueryClient();
  return useMutation<ReimportResult, Error, void>({
    mutationFn: () => s4.reimportDataFile(sourceId),
    onSuccess: () => {
      invalidateData(qc);
      void qc.invalidateQueries({ queryKey: ['suggestions'] });
    },
  });
};

export const useUploadDataFile = () => {
  const qc = useQueryClient();
  return useMutation<DataFile, Error, File>({
    mutationFn: (file) => s4.uploadDataFile(file),
    onSuccess: () => invalidateData(qc),
  });
};

/* ── dashboards ───────────────────────────────────────────────────────────── */

/** The route caches for 60 s server-side; matching that here avoids a refetch per tile mount. */
export const useDashboards = (): UseQueryResult<Dashboard, Error> =>
  useQuery({ queryKey: keys.dashboards, queryFn: () => s4.getDashboards(), staleTime: 60_000 });
