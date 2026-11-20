# RideShare matching evaluation

Anya and Meera tested matching in separate browser sessions against the live Supabase backend. The test trips were dated **21 November 2026**. Anya preferred Ola and Meera preferred Rapido. Both saw the same **5:20–5:30 p.m.** shared departure window.

| Case | Expected | Actual |
|---|---|---|
| Nearby points, overlapping windows, different cab preferences | Both travelers see **5:20–5:30 p.m.** | Both travelers saw the shared window |
| Pickup several kilometres away | Exclude the pair | **No matches yet** |
| Drop-off several kilometres away | Exclude the pair | **No matches yet** |
| Meera starts at 5:31 p.m., one minute after Anya’s window ends | Exclude the pair | **No matches yet** |
| Anya posts a second nearby trip with an overlapping window | Exclude her own trip | Only Meera appeared |

**Refresh matches** picked up Meera’s trip after Anya’s initial empty result. A separate simulation verified the retry message for a lookup failure and disabled refresh after the trip’s departure window ended.
