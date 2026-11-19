# v0.7.0 Kameleo token and worker install

Applied as migration `dicedrop_v0_7_0_kameleo_and_worker_config`.

- Kameleo personal access token in the vault (`dicedrop_kameleo_pat`): `dd_ops_kameleo_save`, `dd_ops_kameleo_clear`.
- `dd_worker_config(box token)`: what a box needs to install (box name + Kameleo token).
- `public/dd/install.sh`: one-line box installer (Docker, Kameleo, worker).
- `public/dd/worker.py` + `public/dd/version.txt`: the worker. Boxes re-download it when the version changes.
