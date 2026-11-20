# RideShare deployment evaluation

- GitHub repository [kumargulshann/ride-share](https://github.com/kumargulshann/ride-share)
- App commit `7fda755a558d380ceb05784b74c0bbfa35a9bbc1` on `main`
- Stable public production URL [ride-share-seven-omega.vercel.app](https://ride-share-seven-omega.vercel.app/)

RideShare uses plain HTML and JavaScript. Vercel uses the **Other** preset, repository root, `npm ci`, `npm run build`, and the `dist` output directory. The build reads `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`.

| Check | Result |
|---|---|
| GitHub source and repository boundary | Verified that GitHub `main` matches the local app commit. The repository contains only RideShare source, migrations and evaluations. |
| Production build and configuration | The local build produced 17 allowlisted public files. It included the intended Supabase URL and publishable key. Private configuration files and credentials were excluded. The public configuration reached the existing Supabase project with anonymous sign-in enabled. |
| Signed-out access on Vercel | The stable URL returned HTTP 200 without login cookies and opened directly to RideShare in the in-app browser. |
| Deployed assets and configuration | All 13 runtime assets matched the local build. The production configuration matched the intended Supabase project and publishable key. Requests for environment files, Git configuration, the preview server, and the evaluations returned HTTP 404. The optional Leaflet debugging source map returned HTTP 403. Map tiles loaded and pin selection worked. |
| First-time reviewers and trip saves | Reviewer Anya signed in from a fresh in-app browser session and Reviewer Meera signed in from Chrome Incognito. Each selected pickup and drop-off pins on the map and saw “Trip saved.” Anya posted for 22 November 2026, 8:05–8:20 a.m. IST with Ola. Meera posted for the same date, 8:10–8:25 a.m. IST with Rapido. |
| Matching in both directions | Each traveler saw the other with the same 8:10–8:20 a.m. shared departure window. |
| Sharing request and acceptance | Anya saw “Request sent.” Meera saw one pending incoming request and accepted it. Anya saw the acceptance and Open chat action without refreshing. |
| Private chat in both directions | Both travelers opened the same conversation. Meera received “Production check: can we meet at the main gate?” and Anya received “Production check: yes, 8:10 works.” Both messages arrived without a manual refresh. |
| Session and chat persistence | Reloading the chat in both browsers restored each traveler’s session and showed the same two messages in the original order. |
| Physical phone keyboard | Pending testing on a phone. |
