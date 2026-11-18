# v0.3.0: Contabo connection

The v0.3.0 database change is applied as the Supabase migration `dicedrop_v0_3_0_contabo`
(its full SQL is kept in the project's migration history: `supabase_migrations.schema_migrations`).

What it adds:

- Extensions `http` and `pg_cron`.
- Server columns on `boxes` (`provider`, `provider_instance_id`, `server_status`, `server_ip`, and specs).
- `contabo_state`, `provider_ignored`, and `box_events` tables.
- Credentials are stored in Supabase Vault under the name `dicedrop_contabo` and never leave the database.
  The database itself calls Contabo: `dd_contabo_token`, `dd_contabo_sync_internal`, and `dd_ops_contabo_action`.
- Operator functions: `dd_ops_contabo_save`, `dd_ops_contabo_sync`, `dd_ops_contabo_status`,
  `dd_ops_contabo_disconnect`, `dd_ops_contabo_restore_ignored`, `dd_ops_contabo_action`, `dd_ops_remove_box`.
- A scheduled job, `dicedrop-contabo-sync`, refreshes server status every 2 minutes while connected.
