export interface SearchLogInput {
  userId: string | null;
  q: string;
  filters: Record<string, unknown>;
  results: number;
  tookMs: number;
}
/** Usage sink implemented by W5 (`topic_views`, `search_log`). Callers never await failures — implementations must swallow and log. */
export interface UsageRecorder {
  recordTopicView(userId: string, topicId: string): Promise<void>;
  recordSearch(entry: SearchLogInput): Promise<void>;
}
