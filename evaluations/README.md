# Can two travelers with compatible trips find each other and agree on a meeting point before booking a cab?

Two independent test accounts completed the flow on [RideShare production](https://ride-share-seven-omega.vercel.app/). They found each other, agreed to open a chat, and exchanged messages about meeting at the main gate. The tests show the app supports that coordination. Real travelers’ willingness to share, completed rides, and fare savings remain unmeasured.

## What we verified

| Scenario | Expected behavior | Observed result | Test environment |
|---|---|---|---|
| End-to-end reviewer journey | Open the site without a hosting login, post two compatible trips, match, accept a request, and exchange messages. | Both accounts saved trips with map pins and saw the same 8:10–8:20 a.m. IST overlap despite different cab preferences. Anya saw Meera’s acceptance without refreshing, and each received one message without refreshing. | Vercel production and live Supabase |
| Pickup or destination several kilometres away | Exclude the pair when either point falls outside its 1 km limit. | Both cases displayed **No matches yet** when tested separately. | Local preview and live Supabase |
| Departure windows miss by one minute | Exclude the pair. | **No matches yet**. | Local preview and live Supabase |
| Duplicate and simultaneous sharing requests | Keep one request for the pair of trips. | A double tap produced one incoming request and a badge of 1. When both travelers sent requests, the app kept one and offered the recipient **Review request**. A direct retry returned the original request ID. | Local preview and live Supabase for the browser checks. Direct local PostgreSQL for the retry. |
| Live acceptance and chat updates | Show the decision and messages automatically. | Acceptance appeared in about **4.7 seconds**. Chat messages arrived in **3.9 seconds** from Anya to Meera and **1.0 second** in the other direction. These are individual observations. | Local preview and live Supabase |
| Duplicate chat messages | Store one copy after a double tap or retry. | The double tap left one copy in each history. Retrying the same message ID returned the original message. | Local preview and live Supabase for the double tap. Direct local PostgreSQL for the retry. |
| Chat privacy and closure | Block unrelated accounts and reject sends after closure while preserving history. | Supabase denied a third account’s read, send, and close attempts. A send from a stale open chat was rejected after closure, and the draft and history remained. | Direct live Supabase API for the third account. Local preview and live Supabase for closure. |
| Refresh both browsers | Keep each traveler signed in and reopen the same chat with its messages in order. | Both sessions restored the conversation and the two test messages in order. The local preview also preserved each identity and its own saved trips. | Vercel production and local preview, both with live Supabase |
| Keyboard open on a physical phone | Keep Send reachable while typing. | **Untested on a physical phone.** Send was reachable at 319 px in a desktop browser. | Local preview for the narrow browser check |

Detailed records are available for [matching](matching.md), [private chat](chat.md), and [production deployment](deployment.md). Sharing-request observations come from the build chat.

## Two-browser reviewer walkthrough

1. **Sign in.** Open [RideShare production](https://ride-share-seven-omega.vercel.app/) in a regular browser window and a private window or separate browser profile. Enter two distinct display names, such as `Review Anya` and `Review Meera`. Expect each session to show its own name.
2. **Post two trips.** In both sessions, choose **tomorrow** and use the same device time zone. Agree on two recognizable map landmarks for pickup and drop-off, then select the same two pins in both sessions. For example, choose the Chandra Shekhar Azad University campus and Kanpur Central railway station. Label the pins and select at least one cab service. Use **5:10–5:30 p.m.** for Anya and **5:20–5:40 p.m.** for Meera. Expect **Trip saved** in both sessions.
3. **Find each other.** Open **Saved trips → Find matches** on each new trip. Use **Refresh matches** if a search was opened before the other trip was posted. Expect the other reviewer’s name and a shared **5:20–5:30 p.m.** window in both sessions.
4. **Connect.** From Anya’s match card, choose **Request to share**. In Meera’s **Requests**, accept the incoming request. Expect both travelers to see **Open chat**.
5. **Coordinate.** Open chat in both sessions. Have Anya send “Can we meet at the pickup landmark at 5:20 p.m.?” and Meera reply “Yes, I can meet there at 5:20 p.m.” Expect each message to appear for the other traveler without refreshing.
6. **Reload.** Refresh both chat pages. Expect each session to reopen the same conversation with both messages in order.
