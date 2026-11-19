# v0.16.2 sign-ups locked
- Trigger `dd_block_new_users` on `auth.users`: a new login is created only for an email already listed in `platform_admins` (currently dysn@dysndysn.com). Everyone else gets "Sign-ups are closed."
- Database only; no app change.
