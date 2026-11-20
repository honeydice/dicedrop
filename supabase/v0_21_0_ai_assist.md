# v0.21.0 AI helper for the worker
- Table `ai_assist_log` (every AI look and its answer, 30 days). `dd_worker_assist` (box asks / records, 150 looks an hour per box), `dd_ops_assist_log`.
- Route `/api/worker/v1/assist`: the box sends a screenshot, the page's words and a numbered list of elements; the model answers with one action.
- Key: `ANTHROPIC_API_KEY` in the Vercel project (never on a box). The model never receives passwords or card details.
