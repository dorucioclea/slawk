# Slawk Security Review

**Date:** 2026-03-07
**Reviewer:** Claude Opus 4.6
**Scope:** Full-stack security review of the Slawk application (Slack clone)
**Codebase:** Vite+React frontend, Express+Prisma backend, Socket.IO WebSocket, PostgreSQL

---

## Executive Summary

This review covers 7 security domains across the full Slawk stack. A total of **105 findings** were identified across all domains, with some overlap between workers (noted via cross-references). After deduplication, the unique finding count is approximately **82**.

| Severity | Count (raw) | Key Themes |
|----------|-------------|------------|
| Critical | 1 | Hardcoded default JWT secret in `.env` |
| High | 15 | Token lifecycle (localStorage, no refresh, no revocation), download token scoping, input validation gaps, multer CVE |
| Medium | 40 | Missing authorization checks, CSP weaknesses, CORS wildcards, unbounded maps, missing DB constraints |
| Low | 35 | Timing side-channels, enumerable IDs, missing sanitization, minor validation gaps |
| Info | 14 | Positive findings, cosmetic issues, dev-only concerns |

### Top 10 Priority Issues

| # | ID(s) | Severity | Issue | Impact |
|---|-------|----------|-------|--------|
| 1 | INFRA-001 | Critical | Hardcoded default JWT secret in `.env` | Full account takeover in misconfigured deployments |
| 2 | AUTH-001 | High | JWT stored in localStorage | Any XSS exfiltrates 7-day token |
| 3 | AUTH-002, AUTH-003 | High | No token refresh or server-side revocation | Stolen tokens irrevocable for 7 days |
| 4 | INFRA-002 | High | Multer DoS CVE (GHSA-5528-5vmv-3xc2) | Process crash via crafted upload |
| 5 | AUTHZ-001, AUTHZ-002, INJ-003 | High | Download tokens unscoped / unvalidated | Leaked token grants access to all files |
| 6 | WS-001 | High | No WebSocket token revalidation | Sessions persist past expiry/revocation |
| 7 | INJ-001 | High | ReDoS-vulnerable emoji regex | Arbitrary strings stored as "emoji" reactions |
| 8 | INJ-002 | High | Unvalidated search query parameter | DoS via expensive DB queries |
| 9 | XSS-002 | High | CSP `script-src 'unsafe-inline'` | Undermines XSS defense in development |
| 10 | WS-002 | Medium | No room eviction on channel removal | Removed users continue receiving messages |

### Cross-Reference: Duplicate Findings

Several issues were independently identified by multiple workers:

| Issue | Findings |
|-------|----------|
| JWT in localStorage + long expiry + no revocation | AUTH-001, AUTH-002, AUTH-003, INFRA-015 |
| Download token scoping | AUTHZ-001, AUTHZ-002, INJ-003, FILE-001 |
| CORS wildcard in dev | XSS-006, WS-013, INFRA-003 |
| Brute force lockout in-memory | AUTH-004, INJ-011, INFRA-011 |
| WebSocket token revalidation | AUTH-006, WS-001 |
| Socket on `window` in dev | AUTH-012, WS-004 |
| No server-side HTML encoding | XSS-003, WS-015 |
| Rate limit map unbounded | INJ-012, WS-008, INFRA-016 |
| Login schema missing min password | AUTH-007, INJ-004 |

---

## 1. Authentication & Session Management

**Files reviewed:** `backend/src/routes/auth.ts`, `backend/src/middleware/auth.ts`, `backend/src/config.ts`, `frontend/src/stores/useAuthStore.ts`, `frontend/src/lib/socket.ts`, `backend/src/websocket/index.ts`, `frontend/src/lib/api.ts`

### AUTH-001 | High | JWT Stored in localStorage -- Exposed to XSS

**Description:** The JWT is stored in `localStorage` and attached to every request via a JavaScript-constructed `Authorization` header. Any XSS vulnerability anywhere in the application grants an attacker full access to steal the token, which remains valid for 7 days with no revocation mechanism.

**Location:**
- `frontend/src/stores/useAuthStore.ts:31,56` (`localStorage.setItem('token', token)`)
- `frontend/src/lib/api.ts:97,103` (`Authorization: Bearer ${token}`)
- `frontend/src/lib/socket.ts:12,16` (`localStorage.getItem('token')`)

**Impact:** A single XSS vector allows token exfiltration and impersonation for the full 7-day token lifetime. Since there is no server-side revocation (AUTH-003), the stolen token remains valid even after password change or logout.

**Recommendation:** Store the JWT in an `httpOnly`, `Secure`, `SameSite=Strict` cookie. For WebSocket auth, pass the cookie via the handshake. If localStorage must be used, implement short-lived access tokens (5-15 min) with server-side refresh tokens in httpOnly cookies.

---

### AUTH-002 | High | No Token Refresh Mechanism -- 7-Day Static JWT

**Description:** Tokens are issued with a fixed 7-day expiry with no refresh token flow. Users remain authenticated for the full 7 days with the same token.

**Location:** `backend/src/routes/auth.ts:83-86,141-144` (`expiresIn: '7d'`)

**Impact:** A stolen token is valid for up to 7 days. Users experience hard logout after 7 days regardless of activity.

**Recommendation:** Implement a dual-token system: short-lived access token (5-15 min) and long-lived refresh token (7-30 days) backed by a server-side allowlist for revocation.

---

### AUTH-003 | High | No Server-Side Token Revocation / Blocklist

**Description:** No mechanism to invalidate a JWT before expiry. Logout only removes the token from `localStorage` client-side. The token remains valid on the server for up to 7 days after "logout."

**Location:**
- `frontend/src/stores/useAuthStore.ts:44-50` (client-only logout)
- `backend/src/middleware/auth.ts:16-24` (no blocklist check)

**Impact:** Stolen or intercepted tokens remain valid even after logout or password change. No mechanism to force-disconnect compromised accounts.

**Recommendation:** Implement a `tokenVersion` field on the User model. Include it in JWT payload and reject tokens with stale versions. Increment on password change, forced logout, or security events.

---

### AUTH-004 | Medium | Brute Force Lockout Uses In-Memory Map

**Description:** Account lockout uses a JavaScript `Map` that is lost on restart, per-process in multi-instance deployments, and never cleaned up. Threshold is 10 attempts.

**Location:** `backend/src/routes/auth.ts:22-24`

**Impact:** Lockout bypassed by server restart or load balancer distribution. Map grows unboundedly from unique email attempts (memory exhaustion).

**Recommendation:** Use Redis with TTL-based expiry. Lower threshold to 5. Add IP-based rate limiting. Implement periodic cleanup.

---

### AUTH-005 | Medium | Password Change Does Not Invalidate Existing Sessions

**Description:** Password changes leave existing JWTs valid because the payload only contains `userId` with no `tokenVersion` or `passwordChangedAt` claim.

**Location:** `backend/src/middleware/auth.ts:16-24`

**Impact:** A compromised account remains accessible to the attacker for up to 7 days after password change.

**Recommendation:** Add `tokenVersion` to User model, include in JWT, and validate in auth middleware.

---

### AUTH-006 | Medium | WebSocket Token Validated Only on Initial Connection

**Description:** JWT validated only during Socket.IO handshake. Once connected, the socket remains authenticated indefinitely -- even past token expiry or account deactivation.

**Location:** `backend/src/websocket/index.ts:96-114`

**Impact:** WebSocket connections persist beyond 7-day token expiry. Stolen token + established connection = indefinite access.

**Recommendation:** Implement periodic re-validation (every 5 min). Force disconnect on password change via `io.in('user:${userId}').disconnectSockets(true)`.

---

### AUTH-007 | Low | Login Schema Missing Min Password Length

**Description:** `loginSchema` has `password: z.string().max(72)` but no `.min()`, unlike `registerSchema` which enforces `.min(6)`.

**Location:** `backend/src/routes/auth.ts:17-19`

**Recommendation:** Add `.min(1)` to reject empty passwords at validation layer.

---

### AUTH-008 | Low | JWT Missing Audience/Issuer Claims

**Description:** JWT payload contains only `{ userId }` with no `iss`, `aud`, or `sub` claims. `jwt.verify` does not validate these.

**Location:** `backend/src/routes/auth.ts:83-84`, `backend/src/middleware/auth.ts:17`

**Recommendation:** Add `issuer: 'slawk'` and `audience: 'slawk-api'` to sign/verify options.

---

### AUTH-009 | Low | Hydration Parses JWT Payload Without Validation

**Description:** `hydrate()` manually decodes JWT via `atob(token.split('.')[1])` to extract pre-fetch hints. Malformed tokens could cause unexpected UI behavior.

**Location:** `frontend/src/stores/useAuthStore.ts:78-88`

**Recommendation:** Validate `payload.userId` is a positive integer before setting state.

---

### AUTH-010 | Low | Cross-Tab Logout Sync Does Not Handle Login Events

**Description:** The `storage` event listener only handles token removal, not token changes. Logging in as a different user in another tab leaves stale in-memory state.

**Location:** `frontend/src/stores/useAuthStore.ts:113-118`

**Recommendation:** Force page reload when `e.newValue` changes to a different token.

---

### AUTH-011 | Low | Registration Timing Side-Channel

**Description:** Registration returns early for existing emails (no bcrypt), creating a measurable timing difference that enables email enumeration.

**Location:** `backend/src/routes/auth.ts:31-35`

**Recommendation:** Perform a dummy `bcrypt.hash` when user exists to normalize timing.

---

### AUTH-012 | Info | Socket Exposed on Window in Dev/E2E

**Description:** `window.__socket` exposed when `DEV || VITE_E2E`. Could be exploited if production build accidentally sets `VITE_E2E=true`.

**Location:** `frontend/src/lib/socket.ts:21-23`

---

### AUTH-013 | Info | Bcrypt Cost Factor 10 Is Minimum Recommended

**Description:** OWASP recommends cost factor 12+ as of 2024.

**Location:** `backend/src/routes/auth.ts:37`

---

### AUTH-014 | Info | No HTTPS Enforcement

**Description:** No `Strict-Transport-Security` headers configured. Tokens transmitted in plaintext on non-TLS connections.

---

## 2. Authorization & Access Control

**Files reviewed:** `backend/src/middleware/authorize.ts`, `backend/src/routes/channels.ts`, `backend/src/routes/dms.ts`, `backend/src/routes/messages.ts`, `backend/src/routes/threads.ts`, `backend/src/routes/bookmarks.ts`, plus supporting files

### AUTHZ-001 | High | Download Token Issued Without File-Level Access Check

**Description:** `POST /files/download-token` issues a signed JWT without verifying the requesting user has access to the file identified by `fileId`.

**Location:** `backend/src/routes/files.ts:281-294`

**Impact:** Tokens are minted for files the user cannot access. Actual denial only happens at download time.

**Recommendation:** Verify file access before signing the token. Validate `fileId` as a positive integer.

---

### AUTHZ-002 | High | Non-File-Scoped Download Tokens Bypass File Authorization

**Description:** When `fileId` is omitted from the token request, the resulting JWT has no file scope. The check at line 307 is skipped when `payload.fileId` is undefined.

**Location:** `backend/src/routes/files.ts:281-294,297-318`

**Impact:** A leaked non-scoped token acts as a 5-minute session token for all accessible file downloads.

**Recommendation:** Require `fileId` as mandatory. Always enforce file-level scoping in download tokens.

---

### AUTHZ-003 | Medium | Any Channel Member Can Pin/Unpin Any Message

**Description:** Pin/unpin endpoints only check channel membership, not message ownership or role.

**Location:** `backend/src/routes/threads.ts:164-212`

**Recommendation:** Restrict pin/unpin to message author, original pinner, or channel admins.

---

### AUTHZ-004 | Medium | Any Channel Member Can Add Members to Public Channels

**Description:** `POST /channels/:id/members` allows any member to forcibly add users to public channels without consent.

**Location:** `backend/src/routes/channels.ts:304-372`

**Recommendation:** Consider invitation flow or restrict to admins.

---

### AUTHZ-005 | Medium | Private Channel Creator Relies on Join Order

**Description:** Creator determined by querying first `ChannelMember` by `joinedAt`. If creator leaves and rejoins, they lose creator status.

**Location:** `backend/src/routes/channels.ts:312-318`

**Recommendation:** Add explicit `createdBy`/`ownerId` field to Channel model, or `role` field to ChannelMember.

---

### AUTHZ-006 | Medium | Channel GET Leaks Member List to Non-Members

**Description:** `GET /channels/:id` returns full member list (including emails) for public channels to any authenticated user.

**Location:** `backend/src/routes/channels.ts:126-170`

**Recommendation:** Exclude emails from member list for non-members. Return only metadata and member count.

---

### AUTHZ-007 | Low | Search Authorization Correct but Fragile

**Description:** Search filters by user's channel memberships correctly, but the code structure (silent skip without explicit return) makes it easy to introduce bugs.

**Location:** `backend/src/routes/search.ts:30-65`

---

### AUTHZ-008 | Low | Sequential Integer IDs Enable Enumeration

**Description:** All resources use sequential auto-increment IDs. Different error responses for "not found" vs "forbidden" reveal resource existence.

**Recommendation:** Use consistent 404 responses for both cases, or migrate to UUIDs.

---

### AUTHZ-009 | Low | WebSocket Membership Cache Creates 30-Second Lag

**Description:** Positive membership cached for 30 seconds. Removed users can send typing indicators for up to 30s.

**Location:** `backend/src/websocket/index.ts:119-132`

---

### AUTHZ-010 | Info | No Admin/Moderator Role System

**Description:** All channel members have equal permissions. Known gap documented in project.

---

### AUTHZ-011 | Medium | DM File Attachments Lack Authorization Model

**Description:** `requireFileAccess` only checks channel membership. No equivalent for DM file access. If DM file attachments are added, the authorization model has a gap.

**Location:** `backend/src/middleware/authorize.ts:84-138`

---

### AUTHZ-012 | Medium | Bookmark Operations on DM Messages Not Explicitly Blocked

**Description:** Bookmark endpoints use `requireMessageAccess` which only queries the `Message` table, not `DirectMessage`.

**Location:** `backend/src/routes/bookmarks.ts:11-60`

---

### AUTHZ-013 | Low | Avatar Serving Has No Authentication

**Description:** `GET /users/me/avatar/:filename` serves images without auth. Filenames are UUIDs (hard to guess).

**Location:** `backend/src/routes/users.ts:184`

---

### Positive Authorization Findings

1. Channel message read/write requires membership via `requireChannelMembership`
2. Message edit/delete enforces ownership on both REST and WebSocket
3. DM access control correctly verifies sender/recipient
4. Cross-channel thread injection prevented
5. File attachment ownership validated atomically in transactions
6. Private channel join blocked for uninvited users
7. Soft-deleted messages excluded via `deletedAt` checks
8. WebSocket auth rejects scoped tokens (prevents download tokens as session tokens)
9. Scheduled message deletion verifies ownership

---

## 3. Input Validation & Injection

**Files reviewed:** All `backend/src/routes/*.ts`, `backend/src/middleware/authorize.ts`, `backend/src/websocket/index.ts`, `backend/prisma/schema.prisma`

### INJ-001 | High | ReDoS-Vulnerable Emoji Regex

**Description:** The `emojiRegex` pattern `/^[\p{Emoji}\p{Emoji_Component}\w+_:-]+$/u` accepts arbitrary strings containing `+`, digits, and word characters as valid "emoji" values.

**Location:** `backend/src/routes/reactions.ts:11`

**Impact:** Arbitrary strings stored as emoji reactions, defeating validation purpose.

**Recommendation:** Use separate validators for Unicode emoji codepoints vs shortcodes.

---

### INJ-002 | High | Unvalidated Search Query Parameter

**Description:** `req.query.search as string` passed directly to Prisma `contains` with no Zod validation, no length limit, no type check. Attacker can send megabyte-long strings forcing expensive ILIKE scans.

**Location:** `backend/src/routes/users.ts:239-246`

**Recommendation:** Add Zod validation: `z.string().max(100).optional()`.

---

### INJ-003 | High | Unvalidated fileId in Download-Token Endpoint

**Description:** `req.body?.fileId` used without validation. Can be `null`, `0`, non-integer, or omitted entirely. Omission creates unscoped tokens.

**Location:** `backend/src/routes/files.ts:281-294,307`

**Recommendation:** Validate with Zod as required positive integer.

---

### INJ-004 | High | Login Schema Allows Empty Passwords

**Description:** `loginSchema` defines `password: z.string().max(72)` without `.min()`. Empty strings pass validation, wasting bcrypt computation.

**Location:** `backend/src/routes/auth.ts:16-19`

**Recommendation:** Add `.min(1)` to match registration requirements.

---

### INJ-005 | Medium | parseInt Without Range Validation Across All Routes

**Description:** `parseInt(req.params.id)` used throughout without upper bound validation. Values exceeding PostgreSQL Int max (2,147,483,647) cause 500 errors instead of 400.

**Location:** Multiple files (channels.ts, threads.ts, bookmarks.ts, files.ts, users.ts, dms.ts, reactions.ts, scheduled-messages.ts, authorize.ts)

**Recommendation:** Create shared `parseIntParam()` utility with range validation.

---

### INJ-006 | Medium | No Length Limit on content Field in Prisma Schema

**Description:** `Message.content` and `DirectMessage.content` defined as `String` without `@db.VarChar(4000)`. Zod enforces 4000 chars but DB has no constraint.

**Location:** `backend/prisma/schema.prisma:59,119`

**Recommendation:** Add `@db.VarChar(4000)` for defense in depth.

---

### INJ-007 | Medium | No Length Limit on emoji Field in Prisma Schema

**Description:** `Reaction.emoji` is `String` without DB-level length constraint.

**Location:** `backend/prisma/schema.prisma:86`

**Recommendation:** Add `@db.VarChar(32)`.

---

### INJ-008 | Medium | Channel Name Allows Null Bytes and Control Characters

**Description:** `createChannelSchema` validates against path traversal but not null bytes or control characters, unlike message content which has null byte checks.

**Location:** `backend/src/routes/channels.ts:13-22`

**Recommendation:** Add null byte and control character refinements.

---

### INJ-009 | Medium | originalName Stored Without Length Validation

**Description:** `file.originalname` from multer stored directly without length limit. Used in `Content-Disposition` headers and GCS paths.

**Location:** `backend/src/routes/files.ts:227`, `backend/prisma/schema.prisma:101`

**Recommendation:** Truncate to 255 chars. Add `@db.VarChar(255)` to schema.

---

### INJ-010 | Medium | Unvalidated Emoji URL Parameter in Reaction Deletion

**Description:** `decodeURIComponent(req.params.emoji)` used without Zod validation on DELETE route, unlike POST which validates.

**Location:** `backend/src/routes/reactions.ts:75`

**Recommendation:** Apply same validation schema as creation route.

---

### INJ-011 | Medium | In-Memory Login Lockout Map Unbounded

**Description:** `loginAttempts` Map grows indefinitely. Entries only deleted on successful login, not on lockout expiry.

**Location:** `backend/src/routes/auth.ts:22-24`

**Impact:** Memory exhaustion via millions of unique email login attempts.

**Recommendation:** Cap map size, add periodic cleanup, or use Redis.

---

### INJ-012 | Medium | WebSocket Rate Limit State Map Unbounded

**Description:** `rateLimitState` Map stores per-socket per-event counters. Expired entries never pruned for active connections.

**Location:** `backend/src/websocket/index.ts:37`

**Recommendation:** Add periodic cleanup interval.

---

### INJ-013 | Medium | User Name and Bio Lack Null Byte Filtering

**Description:** `updateProfileSchema` and `registerSchema` validate name/bio without null byte checks, unlike message content fields.

**Location:** `backend/src/routes/users.ts:42-50`, `backend/src/routes/auth.ts:13`

**Recommendation:** Add `.refine(val => !val.includes('\u0000'))` to name and bio fields.

---

### INJ-014 | Low | limit Query Parameter Lacks Type Validation

**Description:** `parseInt(req.query.limit as string) || 50` could behave unexpectedly with array parameters.

**Location:** `backend/src/routes/files.ts:457`, `backend/src/routes/users.ts:240`

---

### INJ-015 | Low | Avatar URL Validation Only Checks Protocol Prefix

**Description:** Any `https://` URL accepted as avatar (e.g., `https://evil.com/tracking.png`).

**Location:** `backend/src/routes/users.ts:44-47`

---

### INJ-016 | Low | Range Header Parsing Not Strictly Validated

**Description:** Range header split-based parsing doesn't strictly validate HTTP spec format.

**Location:** `backend/src/routes/files.ts:358-368`

---

### INJ-017 | Low | Scheduled Message scheduledAt Unbounded

**Description:** No upper bound on schedule date. Messages can be scheduled for year 9999.

**Location:** `backend/src/routes/scheduled-messages.ts:17,26-29`

---

### INJ-018 | Low | Channel Name Allows Unicode Lookalike Characters

**Description:** Homoglyph attacks possible (e.g., `generaI` with capital I vs lowercase L).

**Location:** `backend/src/routes/channels.ts:13-22`

---

### INJ-019 | Low | GCS Path Uses Unsanitized Original Filename

**Description:** `file.originalname` used in GCS path construction without sanitization.

**Location:** `backend/src/routes/files.ts:16,94`

---

### INJ-020 | Info | pins.ts Does Not Exist

**Description:** Pin functionality is in `threads.ts` and `channels.ts`, not a separate file.

---

### Positive Validation Findings

1. All `prisma.$queryRaw` calls use parameterized tagged template literals
2. Null byte filtering on message content fields throughout
3. File upload magic byte validation via `file-type` library
4. WebSocket payloads validated with Zod schemas
5. Scoped JWT token separation (purpose claim)
6. Avatar serving validates resolved path starts with uploadDir
7. Cross-channel thread injection prevented

---

## 4. XSS & Frontend Content Security

**Files reviewed:** `frontend/src/lib/renderMessageContent.tsx`, `frontend/src/components/Messages/Message.tsx`, `frontend/src/components/Messages/MessageInput.tsx`, `frontend/src/components/Messages/LinkModal.tsx`, `frontend/index.html`, `frontend/vite.config.ts`

### XSS-001 | High | Markdown Link URL Validation Relies Solely on Regex

**Description:** The `renderInline()` function matches `[text](url)` links with `(https?:\/\/[^\s)]+)` which blocks `javascript:` URIs -- but only because the regex restricts to `http(s)`. No explicit URL protocol validation after the match. If the regex is ever loosened, stored XSS becomes possible.

**Location:** `frontend/src/lib/renderMessageContent.tsx:10,37`

**Impact:** Currently safe. Risk is fragility: any regex change could open XSS.

**Recommendation:** Add explicit `new URL()` protocol validation after regex match.

---

### XSS-002 | High | CSP script-src 'unsafe-inline'

**Description:** The `<meta>` CSP tag in `index.html` includes `script-src 'self' 'unsafe-inline'`, undermining CSP as an XSS defense. Backend helmet CSP is stricter but only applies when HTML is served through Express.

**Location:** `frontend/index.html:10`

**Impact:** In development and any deployment serving HTML without backend headers, inline scripts execute freely.

**Recommendation:** Remove `'unsafe-inline'` from meta tag. Use nonce-based approach for Vite HMR if needed.

---

### XSS-003 | Medium | No Server-Side HTML Encoding of Message Content

**Description:** Backend stores and serves raw user content. React's JSX escaping handles rendering, but non-React consumers would be vulnerable.

**Location:** `backend/src/routes/messages.ts:48`, `backend/src/websocket/index.ts:236`

**Recommendation:** Document that API consumers must treat content as untrusted plaintext. Consider server-side encoding for defense in depth.

---

### XSS-004 | Medium | CSP img-src Allows data: URIs

**Description:** Both meta tag and helmet CSP include `data:` in `img-src`. SVG data URIs could contain embedded scripts (though browsers block in `<img>` context).

**Location:** `frontend/index.html:10`, `backend/src/app.ts:33`

**Recommendation:** Remove `data:` from `img-src` if not needed.

---

### XSS-005 | Low | User Display Names Not Sanitized for Bidi Characters

**Description:** RTL override characters stripped from message content but not from user names rendered elsewhere.

**Location:** `frontend/src/components/Messages/Message.tsx:111`

---

### XSS-006 | Medium | CORS Wildcard in Development Mode

**Description:** CORS defaults to `'*'` in non-production. Any website can make API requests to the backend.

**Location:** `backend/src/app.ts:41`, `backend/src/websocket/index.ts:84`

**Recommendation:** Default to `http://localhost:5173` instead of `'*'`.

---

### XSS-007 | Low | Quill Editor Processes Pasted HTML

**Description:** Quill processes pasted HTML before serialization. Clipboard matchers strip `<img>` but not `<object>`, `<embed>`, `<svg>`.

**Location:** `frontend/src/components/Messages/MessageInput.tsx:149-265`

---

### XSS-008 | Low | Avatar src From API Without Frontend Validation

**Description:** Avatar `<img>` src set directly from API data without frontend URL validation.

**Location:** `frontend/src/components/ui/avatar.tsx:55`

---

### Positive XSS Findings

1. **Zero uses** of `dangerouslySetInnerHTML`, `innerHTML`, or `eval()` in the frontend
2. React JSX auto-escaping used consistently for all user content
3. `renderMessageContent()` outputs React elements, not raw HTML
4. Bidi character stripping on message content
5. Message length capped at 10,000 chars (prevents regex abuse)
6. Link protocol validation in Quill serialization
7. `target="_blank"` links include `rel="noopener noreferrer"`
8. File magic byte validation prevents MIME spoofing
9. SVG excluded from inline-serving whitelist
10. Source maps disabled in production builds

---

## 5. File Upload & Download Security

**Files reviewed:** `backend/src/routes/files.ts`, `backend/src/routes/users.ts`, `backend/src/middleware/authorize.ts`, `frontend/src/components/Messages/FilePreview.tsx`, `frontend/src/lib/api.ts`

### FILE-001 | Medium | Download Token Not Scoped to File by Default

**Description:** `POST /files/download-token` issues tokens without `fileId` (optional). Frontend never sends `fileId`. Every download token grants access to all user-accessible files for 5 minutes.

**Location:** `backend/src/routes/files.ts:281-294`, `frontend/src/lib/api.ts:16-31`

**Impact:** Leaked token (via Referer, logs, browser history) exposes all accessible files.

**Recommendation:** Issue per-file tokens. Require `fileId` in token request.

---

### FILE-002 | Medium | No Path Traversal Guard on Local File Download

**Description:** `path.join(uploadDir, file.filename)` without `startsWith(uploadDir)` guard, unlike avatar endpoint which has this check.

**Location:** `backend/src/routes/files.ts:342,435`

**Recommendation:** Add `path.resolve` + `startsWith` guard matching avatar endpoint pattern.

---

### FILE-003 | Medium | Missing X-Content-Type-Options on File Downloads

**Description:** No explicit `X-Content-Type-Options: nosniff` on file download or avatar responses. Relies on helmet's global setting which may not apply to streamed responses.

**Location:** `backend/src/routes/files.ts:352-354`, `backend/src/routes/users.ts:191-198`

**Recommendation:** Explicitly set `nosniff` header on file-serving endpoints.

---

### FILE-004 | Medium | GCS Signed URL Expiry Too Long (7 Days)

**Description:** Upload and file-info endpoints generate GCS signed URLs with 7-day expiry. These bypass all application access controls.

**Location:** `backend/src/routes/files.ts:100-104,265-268`

**Impact:** Leaked GCS URLs grant unauthenticated access for 7 days.

**Recommendation:** Reduce to 15-30 minutes. Force clients through `/files/:id/download`.

---

### FILE-005 | Medium | Original Filename Stored Unsanitized

**Description:** `file.originalname` from multer stored without sanitization. Used in GCS path construction where path separators could manipulate object path.

**Location:** `backend/src/routes/files.ts:227,94`

**Recommendation:** Sanitize filename. Use UUID-only for GCS path. Limit length to 255 chars.

---

### FILE-006 | Low | Extension Preserved from Client-Supplied Filename

**Description:** File extension extracted from `originalname` and appended to UUID, not derived from detected MIME type.

**Location:** `backend/src/routes/files.ts:33-34`

---

### FILE-007 | Low | Avatar Endpoint Unauthenticated

**Description:** Avatar images served without auth. Filenames are UUIDs (hard to guess).

**Location:** `backend/src/routes/users.ts:184-199`

---

### FILE-008 | Low | No Antivirus/Malware Scanning

**Description:** Files validated for MIME type but not scanned for malware. ZIP and PDF allowed.

**Location:** `backend/src/routes/files.ts:43-68`

---

### FILE-009 | Low | ZIP Bomb Not Fully Mitigated

**Description:** 10MB size limit helps, but no check on decompressed size or nesting depth for ZIP files.

**Location:** `backend/src/routes/files.ts:40-41`

---

### FILE-010 | Low | Race Condition Between Upload and Cleanup

**Description:** If process crashes between multer write and validation cleanup, orphaned files accumulate.

**Location:** `backend/src/routes/files.ts:142,157`

---

### FILE-011 | Low | Content-Disposition Header Injection

**Description:** Quoted `filename` fallback only strips 4 characters. Other header-significant characters could cause parsing issues.

**Location:** `backend/src/routes/files.ts:113-116`

---

### Positive File Security Findings

1. Magic-byte validation via `file-type` library
2. Authenticated file downloads (not served via `express.static`)
3. Download token purpose scoping (`purpose: 'file-download'`)
4. Rate limiting on uploads (10/minute)
5. File size limits (10MB general, 5MB avatar)
6. Forced `Content-Disposition: attachment` for non-safe types
7. UUID filenames preventing enumeration
8. Avatar path traversal protection
9. Frontend filename sanitization in download attributes
10. Avatar processing via sharp with pixel limits

---

## 6. WebSocket Security

**Files reviewed:** `backend/src/websocket/index.ts`, `frontend/src/lib/socket.ts`

### WS-001 | High | No Token Revalidation After Initial Handshake

**Description:** JWT validated only during Socket.IO handshake. Connected sockets remain authenticated indefinitely, even past JWT expiry or account deactivation.

**Location:** `backend/src/websocket/index.ts:96-114`

**Impact:** Compromised accounts retain real-time access until connection drops. Stolen expired tokens work on established connections.

**Recommendation:** Periodic re-validation (every 5 min). Force disconnect on password change. Check `exp` claim on each write event.

---

### WS-002 | Medium | Membership Cache + No Room Eviction on Removal

**Description:** 30-second membership cache on typing events. More critically, when a user is removed from a channel, their socket is never removed from the Socket.IO room. They continue receiving all messages.

**Location:**
- `backend/src/websocket/index.ts:119-132` (cache)
- `backend/src/routes/channels.ts:250-257` (broadcast without room eviction)

**Impact:** Removed users continue receiving private channel messages in real-time until they disconnect.

**Recommendation:** Use `io.in('user:${userId}').socketsLeave('channel:${channelId}')` on member removal.

---

### WS-003 | Medium | No Rate Limiting on join:channel and dm:join

**Description:** `join:channel` and `dm:join` events not rate-limited. Each triggers DB queries. Rapid emission causes DB query flooding.

**Location:** `backend/src/websocket/index.ts:26-35,167-188,407-440`

**Recommendation:** Add to `RATE_LIMITS` map (e.g., 20/minute).

---

### WS-005 | Medium | DM Room Join Allows Any User with Any Other User

**Description:** `dm:join` checks for existing DM history, then falls back to checking if target user exists. Any authenticated user can join a DM room with any other user.

**Location:** `backend/src/websocket/index.ts:407-440`

**Recommendation:** Implement contact/allow-list or message request system for first-time DMs.

---

### WS-007 | Medium | Rate Limits Keyed on Socket ID, Bypassable via Reconnect

**Description:** Rate limiting keyed on `socketId`. Disconnecting clears state. Reconnecting gets fresh counters. A crafted client can bypass limits via rapid reconnection.

**Location:** `backend/src/websocket/index.ts:37-61`

**Impact:** Rate limits effectively advisory. Message flooding possible via reconnection cycling.

**Recommendation:** Key on `userId` instead of `socketId`. Don't clear on disconnect; let entries expire naturally.

---

### WS-010 | Medium | getOnlineUserIds() Leaks All Online Users

**Description:** Exported function returns all online user IDs without scoping. Currently unused but available for any route to expose.

**Location:** `backend/src/websocket/index.ts:620-622`

**Recommendation:** Remove export or add userId-scoped filtering via `getSharedUsers()`.

---

### WS-015 | Medium | No Server-Side Content Sanitization

**Description:** Message content validated for length and null bytes but not HTML-sanitized. XSS prevention relies entirely on frontend rendering.

**Location:** `backend/src/middleware/authorize.ts:225-230`, `backend/src/websocket/index.ts:234-241`

**Recommendation:** Apply server-side HTML sanitization for defense in depth.

---

### WS-008 | Low | Rate Limit State Map Grows Unboundedly

**Description:** Map entries for active connections never pruned. Only cleaned on disconnect.

**Location:** `backend/src/websocket/index.ts:37,57-61`

---

### WS-009 | Low | No Maximum Room Membership Cap

**Description:** No limit on simultaneous room memberships per socket.

**Location:** `backend/src/websocket/index.ts:167-188,407-440`

---

### WS-012 | Low | No Handling of Unknown Events

**Description:** Unregistered event names silently accepted. No monitoring for probing attempts.

**Recommendation:** Add `socket.onAny()` catch-all for logging unexpected events.

---

### WS-014 | Low | TOCTOU Race Between Membership Check and DB Write

**Description:** Narrow window between membership check and message creation. Removed user could send one final message.

**Location:** `backend/src/websocket/index.ts:215-258`

---

### Positive WebSocket Findings

1. JWT auth on handshake with algorithm pinning (`HS256`) and scoped-token rejection
2. All write events validated with Zod schemas
3. Channel membership checked on every write operation
4. Message ownership verified for edit/delete
5. `maxHttpBufferSize` set to 16KB
6. File attachment ownership validated in transactions
7. Thread parent channel matching validated
8. Presence broadcasts scoped to shared users via `getSharedUsers()`
9. DM `fromUserId` always set from `socket.user.userId` (no sender spoofing)

---

## 7. Infrastructure, Dependencies & API Hardening

**Files reviewed:** `backend/package.json`, `frontend/package.json`, `backend/.env`, `.gitignore`, `backend/src/app.ts`, `backend/src/middleware/errorHandler.ts`, `backend/src/config.ts`, `Dockerfile`

### INFRA-001 | Critical | Hardcoded Default JWT Secret in .env

**Description:** `backend/.env` contains `JWT_SECRET="your-secret-key-change-in-production"`. While `config.ts` rejects this in production mode, nothing prevents use in staging or misconfigured deployments where `NODE_ENV` is not `production`.

**Location:** `backend/.env:2`

**Impact:** Any attacker who guesses the default value can forge arbitrary JWT tokens and impersonate any user.

**Recommendation:** Remove default from `.env`. Create `.env.example` with empty values and comments. Reject default in all non-development environments.

---

### INFRA-002 | High | Multer DoS Vulnerability (GHSA-5528-5vmv-3xc2)

**Description:** Installed multer version vulnerable to DoS via uncontrolled recursion in multipart parsing.

**Location:** `backend/package.json:33`

**Impact:** Crafted multipart request causes stack overflow / process crash.

**Recommendation:** Update to multer >= 2.1.1.

---

### INFRA-003 | High | CORS Allows All Origins in Development

**Description:** `origin: '*'` for all non-production environments. Duplicated in both `app.ts` and `websocket/index.ts`.

**Location:** `backend/src/app.ts:41-42`, `backend/src/websocket/index.ts:84`

**Recommendation:** Default to `http://localhost:5173`. Centralize CORS config in `config.ts`.

---

### INFRA-004 | High | No .env.example File

**Description:** No `.env.example` or `.env.template`. Developers copy `.env` verbatim with insecure defaults.

**Recommendation:** Create `backend/.env.example` with documented variables and empty secret values.

---

### INFRA-005 | Medium | No Database SSL Configuration

**Description:** `DATABASE_URL` has no `sslmode` parameter. DB traffic unencrypted in production.

**Location:** `backend/.env:1`, `backend/prisma/schema.prisma:6-9`

**Recommendation:** Append `?sslmode=require` for production. Document in `.env.example`.

---

### INFRA-006 | Medium | Console.error Logs Full Error Objects

**Description:** 50+ locations log full error objects which can contain DB credentials, tokens, and internal details.

**Location:** All route files in `backend/src/routes/`

**Recommendation:** Adopt structured logger (pino/winston) with field redaction.

---

### INFRA-007 | Medium | No HTTP Server Timeout Configuration

**Description:** No `server.timeout`, `headersTimeout`, or `requestTimeout` configured. Vulnerable to slow-loris attacks.

**Location:** `backend/src/index.ts:9-18`

**Recommendation:** Set `headersTimeout: 10s`, `requestTimeout: 30s`, `timeout: 120s`.

---

### INFRA-008 | Medium | Docker Image Runs as Root

**Description:** Production Dockerfile never creates or switches to non-root user.

**Location:** `Dockerfile:20-41`

**Recommendation:** Add `adduser` + `USER appuser` to production stage.

---

### INFRA-009 | Medium | No Permissions-Policy Header

**Description:** Helmet configured but `Permissions-Policy` not set. Application doesn't opt out of camera, microphone, geolocation APIs.

**Location:** `backend/src/app.ts:29-40`

**Recommendation:** Add `permissionsPolicy` to helmet config.

---

### INFRA-010 | Medium | CSP img-src Allows External Domains

**Description:** `img-src` allows `randomuser.me` (dev only) and all of `storage.googleapis.com` (overly broad).

**Location:** `backend/src/app.ts:33`

**Recommendation:** Make CSP environment-aware. Restrict GCS to specific bucket.

---

### INFRA-011 | Medium | In-Memory Account Lockout Not Persistent

**Description:** Lost on restart, not shared across instances, grows unboundedly.

**Location:** `backend/src/routes/auth.ts:22-24`

**Recommendation:** Use Redis. Add TTL-based eviction. Cap map size.

---

### INFRA-012 | Low | No URL-Encoded Body Parser

**Description:** Only `express.json()` configured. No `hpp` middleware.

**Location:** `backend/src/app.ts:43`

---

### INFRA-013 | Low | Frontend Quill XSS Vulnerability

**Description:** `quill@2.0.3` has known XSS via HTML export (GHSA-v3m3-f69x-jf25).

**Location:** `frontend/package.json:22`

---

### INFRA-014 | Low | GCS Transitive Vulnerability Chain

**Description:** `@google-cloud/storage` has low-severity transitive vulnerability in `@tootallnate/once`.

**Location:** `backend/package.json:23`

---

### INFRA-015 | Low | JWT 7-Day Expiry with No Revocation

**Description:** Duplicates AUTH-002/AUTH-003. Long-lived tokens with no refresh or revocation mechanism.

---

### INFRA-016 | Low | WebSocket Rate Limit Memory Leak

**Description:** Duplicates INJ-012/WS-008. Rate limit state map not periodically cleaned.

---

### INFRA-017 | Low | Rate Limiting Disabled in Test Environment

**Description:** All rate limiters disabled when `NODE_ENV=test`. If accidentally set in production, no rate limiting at all.

**Location:** `backend/src/app.ts:46-66`

**Recommendation:** Add startup warning if `NODE_ENV=test` with production indicators.

---

### INFRA-018 | Info | No Structured Logging

**Description:** 50+ `console.log/warn/error` calls. No log levels, correlation, or structured output.

---

### INFRA-019 | Info | Shallow Health Check

**Description:** `/health` returns static `{ status: 'ok' }` without checking DB connectivity.

**Location:** `backend/src/app.ts:96-98`

---

### Positive Infrastructure Findings

1. Lockfiles committed (reproducible builds)
2. `.dockerignore` properly configured (excludes .env, .git, node_modules)
3. Helmet security headers configured (HSTS, frame-ancestors, CSP)
4. JSON body size limited to 100KB
5. `npm ci` used in Dockerfile (respects lockfile)

---

## Remediation Priority Matrix

### Immediate (Critical + High)

| Finding | Action | Effort | Status |
|---------|--------|--------|--------|
| INFRA-001 | Remove default JWT secret from `.env`, create `.env.example` | Low | DONE (`.env.example` created) |
| INFRA-002 | `npm audit fix` to update multer | Low | DONE (multer updated, 5 low-severity transitive @google-cloud/storage deps remain) |
| AUTH-001 | Migrate to httpOnly cookie-based auth | High | DEFERRED (architectural change requiring full frontend/backend coordination) |
| AUTH-002/003 | Implement token refresh + revocation (`tokenVersion`) | High | PARTIAL (tokenVersion added to JWT + DB; server-side revocation on password change; full refresh token flow deferred) |
| AUTHZ-001/002 | Require `fileId` in download tokens, validate access | Medium | DONE (Zod validation added) |
| INJ-001 | Fix emoji regex to reject non-emoji strings | Low | DONE |
| INJ-002 | Add Zod validation to search query parameter | Low | DONE |
| INJ-003/004 | Add Zod validation to download-token and login endpoints | Low | DONE |
| XSS-002 | Remove `'unsafe-inline'` from CSP meta tag | Low | DONE |
| WS-001 | Add periodic token revalidation on WebSocket connections | Medium | DONE (5-min interval JWT revalidation) |

### Short-Term (Medium)

| Finding | Action | Effort | Status |
|---------|--------|--------|--------|
| WS-002 | Add room eviction on channel member removal | Low | DONE |
| WS-007 | Key rate limits on userId instead of socketId | Medium | DONE |
| WS-003 | Add rate limits to join:channel and dm:join | Low | DONE |
| INFRA-003 | Restrict CORS to localhost:5173 in dev | Low | DONE |
| INFRA-008 | Add non-root user to Dockerfile | Low | DONE |
| INJ-005 | Create shared parseIntParam utility | Medium | DONE (strict parser rejects "123abc", applied to all route files) |
| INJ-006/007 | Add DB-level varchar constraints | Low | DONE (@db.VarChar on User, Channel, Reaction, File fields + migration applied) |
| FILE-002 | Add path traversal guard to file download/delete | Low | DONE |
| FILE-004 | Reduce GCS signed URL expiry to 15-30 min | Low | DONE |
| INFRA-007 | Add HTTP server timeout configuration | Low | DONE |

### Long-Term (Low + Info)

| Finding | Action | Effort | Status |
|---------|--------|--------|--------|
| AUTHZ-005 | Add explicit role/owner fields to Channel model | Medium | DONE (createdBy field added to Channel, used for private channel creator check) |
| AUTHZ-006 | Restrict member list details for non-members | Low | DONE (emails stripped for non-member viewers) |
| AUTH-005 | Implement tokenVersion for session invalidation | Medium | DONE (tokenVersion in User model + JWT + auth middleware + WS revalidation + password change endpoint) |
| INFRA-006 | Adopt structured logging with field redaction | Medium | DONE (logError utility redacts full error objects; applied across all 13 files) |
| FILE-005 | Sanitize original filenames before storage | Low | DONE |
| INJ-013 | Add null byte filtering to name/bio fields | Low | DONE |
| AUTH-011 | Add dummy bcrypt on registration for timing normalization | Low | DONE |

### Additional Fixes Applied

| Finding | Action | Status |
|---------|--------|--------|
| INJ-008 | Channel name control character filtering | DONE |
| INJ-009 | Truncate originalName to 255 chars | DONE |
| INJ-010 | Validate emoji URL param on DELETE route | DONE |
| INJ-011 | Cap loginAttempts map + periodic cleanup | DONE |
| INJ-012 | Periodic cleanup of rateLimitState map | DONE |
| INJ-017 | Max 30-day scheduling horizon | DONE |
| INJ-019 | GCS path filename sanitization | DONE |
| FILE-003 | X-Content-Type-Options: nosniff on downloads + avatars | DONE |
| WS-010 | Remove unused getOnlineUserIds export | DONE |
| INFRA-004 | Create `.env.example` | DONE |
| INFRA-010 | Environment-aware CSP img-src (scoped GCS bucket) | DONE |
| XSS-004 | Remove `data:` from CSP img-src | DONE |
| AUTH-007/INJ-004 | Login schema `.min(1)` on password | DONE |
| AUTH-004/INJ-011/INFRA-011 | Lockout map bounded + periodic cleanup | DONE |

---

*Report generated 2026-03-07. Review covers codebase at commit 28738f4.*
*Remediation applied 2026-03-07. 30 findings fixed.*
