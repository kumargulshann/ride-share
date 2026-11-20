# RideShare build prompts — condensed from the build chat

## Start with the problem

I wanted to split a cab fare to CNB railway station. I messaged several WhatsApp and Telegram groups at the last minute, couldn’t coordinate a ride in time, and paid the full fare. I wanted to think through an app for finding someone with a nearby pickup and drop-off before building it.

In my revised version, I wanted the app to work for any destination. Travelers would post a departure window and pick one or more preferred services, such as Ola, Uber, or Rapido. I wanted to show active trips with pickups within 1 km, drop-offs within 1 km, and overlapping times. A traveler could dismiss a suggestion or request to share, and the other person could accept or decline. Once both people agreed to connect, they could chat about where to meet, when to leave, who would book, and how to split the fare. I wanted RideShare to help find a ride partner and coordinate. The travelers would handle booking and payment themselves.

## Build the trip form first

I wanted the first milestone to be a phone-friendly trip form built with free tools. I asked to inspect the folder and continue the app if it existed, or create a `ride-share` subfolder if needed. I wanted to pick both points on a map, label them, save their coordinates for later matching, and choose a travel date, departure window, and cab preferences. I wanted a suggestion to post 40–60 minutes before booking, with the option to post whenever I knew my plans.

I asked for a trip summary that would survive a refresh. I wanted to use shared storage if it was already set up, and to know where trips were saved and what setup I needed to do. I asked to run the app, try one valid trip and one invalid departure window, and give me the preview URL and the results before adding matching.

## Give Anya and Meera separate accounts

I wanted to connect the existing form to Supabase Free. I asked for anonymous sign-in with a display name so I could use Anya in a normal window and Meera in a private window. Each person should stay signed in through a refresh. I wanted trip ownership to use the signed-in user ID so two people could have the same display name. I asked for a database migration, an `.env.example` with the variable names, and an early heads-up if I needed to set anything up. I would enter the values locally and keep privileged keys out of the frontend.

I asked to connect **Post trip** and **Saved trips** to Supabase, keep the old local sample separate, and use row-level security so travelers could manage their own trips. I wanted to see **Trip saved** only once the database confirmed the write. If saving failed, I wanted the form to stay filled in and offer a retry. I asked Anya and Meera to post different trips, refresh both sessions, and verify that each saw only their own trip and that Supabase stored two different owner IDs. I wanted the existing map, mobile layout, and validation to keep working.

## Find compatible trips

I wanted **Find matches** on each active saved trip, with the selected trip clearly identified. I asked Supabase to find active trips from other travelers using actual dates and times and unrounded distances. Both pickup points and both drop-off points had to be at most 1,000 metres apart, with a shared departure time that hadn’t passed. Cab preferences could differ. I wanted match cards to show names, approximate areas, the shared window, and cab preferences, with other travelers’ exact pins and private labels kept out of the browser response. I wanted **Refresh matches**, a clear **No matches yet** message, and a separate retry message for lookup failures.

I asked for two independent preview sessions with trips for tomorrow. Anya would use 5:10–5:30 p.m. and Meera 5:20–5:40 p.m., with slightly different nearby pins. Both should see 5:20–5:30 p.m. I asked to change one thing at a time and test a distant pickup, a distant drop-off, and windows that miss by one minute. I also asked to verify that a traveler’s own trips never appear and to report expected and actual results. When both travelers saw the same window despite different cab preferences, I asked to save that results table for the assignment.

## Request, accept, or decline

I wanted **Request to share** and **Skip** on match cards. Skipping should dismiss that suggestion for the selected trip quietly. I wanted **Request sent** after Supabase saved it, with one request per pair of trips even after a double tap, retry, or simultaneous send. I asked for incoming and sent requests, an in-app indicator, and the sender’s name, approximate route, shared window, and cab preferences. I wanted only the two participants to see the request and only the recipient to accept or decline. Supabase should use the signed-in sender and recheck the match when sending or accepting.

I wanted acceptance to mean agreement to chat. Declining should close just that request so both trips could still match with others. I asked to test quiet skipping, duplicate sends, acceptance and refresh, declining a fresh pair, and trying to accept from an open screen after the trip expired. I also asked whether Anya saw Meera’s decision without refreshing so I could decide whether to reuse polling for chat.

## Open a private chat

Anya saw Meera’s decision in 4.7 seconds without refreshing. I thought that was fast enough to reuse the existing four-second polling for the demo. I wanted **Open chat** for both participants after acceptance, with one conversation per request. I wanted the header to show the other traveler, the approximate route, and the shared departure window. Messages should appear in order with clear authors. Blank messages should be blocked, a failed send should keep my draft, and a double tap or retry should leave one copy. I wanted Send to stay reachable with a phone keyboard open.

I asked Supabase to identify the author from the session and allow only the two accepted participants to read or send. Either person could close the conversation to stop new messages, and both could still read its history. I asked Anya to send “Can we meet at the main gate?” and Meera to reply “Yes, I can be there at 5:20.” I wanted the measured delivery times, both messages in order after refresh, and tests for double send, an unrelated account, and a send from a chat left open after the other person closed it. I asked to save the actual results and flag any test that couldn’t run.

## Plan a free public deployment

I wanted the company to be able to open and evaluate the working app on a free public URL. I first asked to reuse suitable hosting or use Cloudflare Pages Free. I wanted a production build with the existing Supabase project and only the intended public Supabase configuration in the browser. If I needed to log in, I wanted to know right away and get the exact deployable folder path and the shortest dashboard steps. I asked to test the full two-user flow on the published site, save the deployment evaluation, and keep the physical-phone keyboard check pending until someone tested it.

## Push to GitHub first, then deploy to Vercel

I changed the publishing plan. I wanted to **push it to my personal GitHub account first, then deploy it to Vercel**, while keeping the existing Supabase backend. I asked to check the Git root and remote, reuse the existing project repository or create a private one if needed, and push only RideShare source, migrations, and evaluations. I wanted the production build checked before pushing, with real environment files, credentials, browser session data, and unrelated files excluded. I supplied the existing GitHub repository and Vercel import screen as context. I would enter any sign-in details directly on the service.

I wanted Vercel to use the project’s actual build settings and the existing public Supabase URL and publishable key. I asked to open the stable production URL while signed out of GitHub and Vercel. With two fresh sessions and future trips, I wanted to verify posting with map pins, matching, acceptance, a message each way, and chat history after refreshing both sessions. I asked for the GitHub link, the public Vercel link to submit, and a saved record of what actually passed and what remained pending.

## Write the reviewer evaluation

I wanted one concise evaluation that starts with the question “Can two travelers with compatible trips find each other and agree on a meeting point before booking a cab?” I asked to compare expected and observed results for the successful flow, wrong pickup or drop-off, non-overlapping times, duplicate requests or messages, privacy, and refresh. I wanted each test labeled by environment and timings included only where they were measured. I asked to distinguish two test accounts coordinating in chat from evidence about real travelers, completed rides, or fare savings.

I wanted a two-browser walkthrough on the production link that would still work after the test trips expired. I asked for tomorrow’s date, the same two recognizable pins, overlapping windows, sample messages, and an expected result at each step. I wanted the summary checked against the detailed records and pushed to GitHub. I would write the personal one-page statement myself.

## Prepare the final handoff

I wanted a condensed record of my actual prompts and a **Try RideShare** section linking to the app, prompts, and evaluation walkthrough. I asked to check the links, test signed-out access to the production URL and GitHub separately, preserve the repository’s visibility, and push the documentation. I wanted the exact files to attach and the tested app left as it was.

**Context for me to check.** I referred to Cloudflare Pages Free as “planned” in the first deployment request. If I need the reasoning behind that earlier plan for the assignment, I should check my planning notes. This chat records the request and my later decision to deploy on Vercel.
