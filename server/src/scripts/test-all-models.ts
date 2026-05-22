/**
 * Probe every enabled model with a minimal request to find broken model IDs.
 *
 * NOTE: This script was written for the old Express/SQLite architecture.
 * For the Cloudflare Workers architecture, run probes via the wrangler dev
 * local server or with a deployed Worker instance.
 *
 * Usage (wrangler dev must be running):
 *   curl -X POST http://localhost:8787/v1/chat/completions \
 *     -H "Authorization: Bearer your-key" \
 *     -H "Content-Type: application/json" \
 *     -d '{"messages":[{"role":"user","content":"ping"}]}'
 */

console.log('Run probe requests against your deployed Worker endpoint.');
console.log('See the comment at the top of this file for instructions.');
