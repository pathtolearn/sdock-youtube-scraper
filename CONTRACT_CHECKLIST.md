# Contract Checklist

Use this checklist before importing the actor into StealthDock.

## File contract (repo root)

- [ ] `actor.yaml`
- [ ] `input.schema.json`
- [ ] `output.schema.json`
- [ ] `Dockerfile`
- [ ] `package-lock.json`
- [ ] `src/main.ts`
- [ ] `src/input.ts`
- [ ] `src/url.ts`
- [ ] `src/youtubeParsers.ts`

Optional but included:

- [ ] `ui.schema.json`
- [ ] `example.input.json`
- [ ] `run.profile.json`

## `actor.yaml` contract

- [ ] `runtime: node`
- [ ] `engine_support` non-empty and only `playwright` / `camoufox`
- [ ] `version` semver (`x.y.z`)
- [ ] `entry` points to `src/main.ts`
- [ ] `schema_semver` set

## Schema contract

- [ ] `input.schema.json` is a JSON object
- [ ] `output.schema.json` is a JSON object
- [ ] At least one of `startUrls` or `searchTerms` is required (validated in runtime input parser)
- [ ] Output schema matches emitted union record fields
- [ ] UI metadata (`x-ui-section`, `x-ui-order`) present for form layout

## Runtime contract

- [ ] Uses internal runtime endpoints for bootstrap, queue, dataset, and events
- [ ] Handles ack/fail paths for each leased request
- [ ] Emits `engine.fallback` when Camoufox requested but unavailable
- [ ] Enforces `maxResults`, `maxRuntimeSeconds`, `maxIdleCycles`, `maxPagesPerSource` (best-effort)
- [ ] Fails invalid input early with explicit error message
- [ ] Emits source summary + video records for expandable sources

## Smoke checklist

- [ ] `npm run test` passes
- [ ] `npm run smoke` passes
- [ ] `npm run start` launches without TypeScript/runtime errors
