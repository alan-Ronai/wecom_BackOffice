/**
 * Accept / edit / reject rates for the suggestion pipeline (spec §1.9).
 *
 * X4a and X4b each wrote this hook against the same route with the same query key. X6 kept one
 * implementation — the one in `suggestionsEdit.ts`, next to the other suggestion routes — and
 * left this module as the name `/admin/ai`'s analytics tab already imports.
 *
 * The caller's `enabled` is its `analytics.read` check: without the permission the route is a
 * guaranteed 403, and asking anyway costs a round trip and a console error on a tab that is
 * about to render the permission notice instead.
 */
export { useSuggestionAnalytics } from './suggestionsEdit.js';
