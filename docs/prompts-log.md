# Build log: Sonia Clarity (i-SmokeStack Developer Challenge)

Private working notes. Source material for the one-page write-up. Not for sending as-is.

## 1. How I worked (disclosure)

| Who | Role |
|---|---|
| Claude (chat) | Planning partner: proposed the concept, stack and build order; drafted my prompts; helped diagnose errors; reviewed Antigravity's output |
| Antigravity | Wrote all of the app code from my prompts |
| Me | Researched her LinkedIn, built the facts file, set up Atlas and the project, sent the prompts, tested, spotted problems, decided what to keep or change |

Honest summary: the concept and the prompt wording started with Claude, and Antigravity wrote the code. I ran, tested and questioned everything, and I am learning each part so I can explain it myself.

**Not done yet, so I must not claim it until it is:**
- [ ] Checked every line of facts.json against her LinkedIn myself
- [ ] Deployed and tested the live site
- [ ] Made at least 2 small code changes by hand (read the code, edited it myself)

## 2. What I took from her profile

Her own words: "I notice what others don't. The gaps, the confusion, the unspoken story, and I help make sense of it." Also: "I don't believe in complicating things." and "I bring structure without chaos."

**FILL (my own words, 3-4 lines):** What I understood about her from reading the profile, and why "clearing confusion into clarity" fits her better than a neon or cyberpunk "futuristic" look.

## 3. The concept

- Proposed by Claude: the visitor wipes away fog (confusion) and a constellation of connected facts appears (clarity).
- I chose to go with it because: **FILL (my reason, in my own words)**
- Rule I gave the AI: every word on the page comes from data/facts.json. Nothing invented about her.

## 4. Prompts (summary; the full text of every prompt is kept in my Claude chat and my Antigravity history)

Claude drafted each prompt, I sent it to Antigravity, and I tested the result.

1. **Fog hero, front end only.** Rule: every word comes from facts.json. Result: fog, constellation, node cards, ending. Good base.
   - KEY PROMPT: [paste full text here, it goes in the write-up]
   - My check: **FILL**
2. **Layout fix.** The ending card covered nodes, and a node card stacked on top of it. I took a screenshot and flagged it; Antigravity fixed it.
3. **Backend and connect form.** /api/connect, /api/event, /stats and event tracking.
   - My check: **FILL**
4. **Security checks.** HTML escaping on the stats page, trust proxy, /.env returns 404. Claude asked for these; Antigravity applied them.
   - My check (does `<b>test</b>` show as plain text on /stats? does /.env return 404?): **FILL**
5. **Form fixes.** Error and success messages showed together. Also removed "I'll be in touch", because it speaks as the founder and promises something she never said. Claude spotted this in my screenshot; I applied the fix.
6. **Rate limit and duplicate submit.** I noticed that sending the form kept failing and suspected the rate limiting. The console showed 429 errors. Claude's likely cause: the form handler was attached twice, so one click sent two requests. Antigravity fixed it. Antigravity's own explanation also claimed an off-by-one bug in the old limiter; Claude checked this and said it was not accurate, so I do not repeat it.
   - KEY PROMPT: [paste full text here, it goes in the write-up]
   - My check (one click = one request in the Network tab?): **FILL**
7. **Scrollbar styling.** Dark thin scrollbar on the ending card to match the design.

## 5. Problems, and who found or fixed what

| Problem | Found by | Fixed by |
|---|---|---|
| Mongo "URI malformed" (special characters in password) | I hit it running the connection test | Claude identified the cause; I reset the password |
| Mongo "querySrv ECONNREFUSED" (my network's DNS could not resolve Atlas) | I hit it running the test | Claude suggested Google DNS in Node; I ran it and it connected |
| facts.json was empty | Claude spotted a length of 0 in my `dir` output | I put the JSON into the file myself |
| Ending card overlapped nodes | Me (screenshot) | Claude drafted the fix prompt; Antigravity applied it |
| "I'll be in touch" success message | Claude | Applied after my approval |
| 429 errors when sending the form | Me (suspected the limiter, sent the console output) | Claude diagnosed the duplicate listener; Antigravity fixed it |
| Stats page security and proxy | Claude raised them | Antigravity; **FILL: I verified it by ...** |

## 6. Decisions

- Calm blue-black with one warm accent, not neon, because her profile is about clarity and simplicity. **FILL: did I agree? why?**
- Hover wiping on desktop so the page reacts without instructions.
- The form appears after the fog melts. Trade-off: a visitor who never clears it does not see the form.
- Analytics are anonymous: random session ID, no IP stored, page is noindex.

## 7. Notes on the brief

- The brief calls her the founder, but her LinkedIn says Fractional CMO. I used LinkedIn's wording.
- Her profile's company-value growth figure is a placeholder, so I left it out.
- Her HubSpot certifications are marked expired, so I do not present them as current.

## 8. My own changes to the code

(Make 2 or 3 small edits by reading the code and changing it yourself. Then list them here.)
- FILL

## 9. What I can explain in my own words

Write one sentence each, no copying. If you cannot, study that part.
- How the fog is drawn and wiped, and how the clear percentage is measured: **FILL**
- How events travel from the page to MongoDB: **FILL**
- How /api/connect validates and what the honeypot is for: **FILL**
- How the rate limiter works: **FILL**
- What /stats shows and why it is protected by a key: **FILL**

## 10. Tests I ran

| Date / time | What | Result |
|---|---|---|
| | One click sends one request (Network tab) | |
| | Form message saved in Atlas | |
| | /stats shows my visit; wrong key gives 401 | |
| | /.env returns 404 (local) | |
| | Live site: fog works by touch on my phone | |
| | Live site: form + stats work | |
| | Live site: /.env returns 404 | |