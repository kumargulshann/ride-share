# RideShare private chat evaluation

Tested on **20 November 2026** in two independent browser sessions against the live Supabase project. Anya and Meera used their existing accepted request for **21 November 2026, 5:20–5:30 p.m. IST**. Delivery times were measured from the sender’s action until the receiving browser showed the message.

| Test | Expected | Actual |
|---|---|---|
| Open chat from an accepted request | Both travelers enter the same conversation and see the other traveler, approximate route, and shared window | Both links opened the same request-specific conversation and displayed the expected trip details |
| Anya sends “Can we meet at the main gate?” | Meera receives it automatically | Appeared in **3.9 seconds**, with no manual refresh |
| Meera replies “Yes, I can be there at 5:20.” | Anya receives it automatically | Appeared in **1.0 second**, with no manual refresh |
| Refresh both sessions | Both messages remain in order, with the correct authors | Both sessions reopened the same chat and showed Anya’s question followed by Meera’s reply. Each sender’s own message was labeled **You** |
| Double-tap Send | One copy of Anya’s message | Each history contained one copy |
| Blank draft | Block sending | The Send button stayed disabled for a whitespace-only draft |
| Unrelated third account | Deny read, send, and close | All three actions were rejected by live Supabase for a separate authenticated test account |
| Send from a stale, already-open chat after closure | Reject the new message and preserve the draft and earlier history | Anya closed the chat. Meera tapped Send before her screen updated. Supabase rejected the send, and her draft and both earlier messages remained. Both sessions still showed the closure after refresh |
| Narrow browser layout | Keep Send visible alongside the composer | Send was reachable with a draft entered at a 319 px browser width. A physical phone keyboard was not tested |

A separate local PostgreSQL test verified that retrying with the same message ID returned the original message, a second accepted request between the same travelers had a separate history, pending requests denied chat access, and the database rejected whitespace-only messages.
