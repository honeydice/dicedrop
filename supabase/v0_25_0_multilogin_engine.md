# v0.25.0 Multilogin as a second browser engine
- `buyer_accounts.engine` (kameleo | multilogin), `mlx_profile` (name or id), `mlx_profile_id`, `mlx_folder_id`; `platform_settings.multilogin_set_at`.
- Vault: `dicedrop_mlx_email`, `dicedrop_mlx_password`. `dd_ops_multilogin_save/clear`, `dd_worker_multilogin`, `dd_ops_set_engine`.
- A Multilogin account needs no DiceDrop proxy (its proxy is saved in the Multilogin profile); dispatch, heartbeat and Open browser allow that.
- Worker installs Multilogin's agent in its own container on first use (Xvfb virtual screen), signs in, finds the profile by name, starts it through the local launcher and drives it like a Kameleo browser.
