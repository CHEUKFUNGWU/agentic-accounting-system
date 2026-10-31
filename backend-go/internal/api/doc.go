// Package api is the REST/SSE adapter layer, mirroring backend/app/api_*.py
// and main.py routes under /api/v1.
//
// P5 (ADR-0002 §3). Handlers translate HTTP to core+store and add nothing:
// no policy, no computation — the depth lives beneath (design.md §api).
// Response shapes are frozen to the D2 contract; contract tests at this seam
// keep the translation honest.
package api
