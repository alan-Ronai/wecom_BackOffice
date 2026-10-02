/**
 * The tool registry plus the two modules that populate it. Import *this*, never `registry.js`
 * directly: `defineTool` runs at import time, so a consumer that skipped these two side-effect
 * imports would see an empty catalogue and offer the model no tools at all.
 */
import './read.js';
import './propose.js';

export * from './registry.js';
