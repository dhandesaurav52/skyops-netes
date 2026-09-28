# Server & Platform Troubleshooting

This runbook provides diagnostic procedures for operational, persistence, authentication, and AI integration issues in the **SkyOps Control Plane** (`server.ts`).

---

## 1. Server Fails to Boot in Production

### Symptoms
The Node.js server crashes immediately on startup with exit code `1`.

### Common Causes & Fixes

#### A. Firestore persistence is unavailable in Production
- **Log message:**
  ```text
  [FATAL] Production startup aborted: Firestore could not be initialized.
  ```
- **Reason:** To prevent silent data loss during container restarts, SkyOps enforces strict fail-closed persistence validation when `NODE_ENV=production`.
- **Fix:** Mount a persistent volume and set the environment variable:
  ```bash
  export PERSISTENCE_PROVIDER=firestore
  ```

#### B. Storage Volume Permission Denied (Probe Write Failed)
- **Log message:**
  ```text
  [FATAL] Startup probe failed: Directory /var/lib/skyops is not writable by current user (UID 10001).
  ```
- **Fix:** Adjust ownership on the mounted persistent volume before starting the container:
  ```bash
  chown -R 10001:10001 /var/lib/skyops
  chmod 700 /var/lib/skyops
  ```

#### C. Port 3000 Already Bound
- **Log message:** `Error: listen EADDRINUSE: address already in use :::3000`.
- **Fix:** Identify and stop the conflicting process:
  ```bash
  lsof -i :3000
  kill -9 <PID>
  ```

---

## 2. Firebase Authentication Failures

### Symptoms
- Frontend login fails with `Invalid Firebase ID token` or `HTTP 401 Unauthorized`.
- Server logs show `Failed to verify Firebase ID token: public key fetch error`.

### Diagnostic Steps
1. Verify the server can reach Google's public x509 certificate endpoint:
   ```bash
   curl -I "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"
   ```
2. Verify clock synchronization (NTP) on the host machine. A clock skew $> 5$ minutes causes JWT signature validation to fail with `Token used before issued` or `Token expired`.

---

## 3. Gemini AI Root Cause Analysis Degraded / Fallback

### Symptoms
- Incident details displays root cause analysis with a yellow badge: `[DETERMINISTIC_FALLBACK]`.
- No AI natural-language narrative is generated.

### Diagnostic Steps
1. Check if `GEMINI_API_KEY` is configured:
   ```bash
   echo $GEMINI_API_KEY
   ```
   If empty, the server automatically defaults to the deterministic rule engine.
2. Verify API key quotas and permissions:
   Test the key with a curl request:
   ```bash
   curl -H "Content-Type: application/json" \
     -d '{"contents":[{"parts":[{"text":"ping"}]}]}' \
     "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}"
   ```
3. Check server logs for timeout notices:
   ```text
   [WARN] Gemini AI analysis timed out after 15,000ms. Falling back to deterministic intelligence engine.
   ```
   *Note: Fallback is safe and graceful; core platform functionality and incident management remain 100% operational.*

---

## 4. SMTP Alert Delivery Failures

### Symptoms
- Incidents open, but no email notifications are received.
- Logs report `ESOCKETTIMEDOUT` or `EAUTH: Invalid login`.

### Diagnostic Steps
1. Trigger a test email from the console under **Settings > Notifications**, or via API:
   ```bash
   curl -X POST \
     -H "Authorization: Bearer <user-jwt>" \
     "https://skyops.yourcompany.com/api/v1/settings/notifications/test"
   ```
2. Inspect recent delivery logs:
   ```bash
   curl -H "Authorization: Bearer <user-jwt>" \
     "https://skyops.yourcompany.com/api/v1/settings/notifications/deliveries"
   ```
3. Common fixes:
   - **Port 25 blocked:** Most cloud providers (AWS, GCP, Azure) block outbound port 25. Switch `SKYOPS_SMTP_PORT` to `587` (STARTTLS) or `465` (SSL).
   - **App Passwords:** When using Gmail/Google Workspace, you must generate a dedicated **App Password**; your regular account password will be rejected.

---

## 5. Webhook Delivery Failures

### Symptoms
- External paging systems or Slack channels do not receive webhook events.

### Diagnostic Steps
1. Review delivery audit history for the specific webhook:
   ```bash
   curl -H "Authorization: Bearer <user-jwt>" \
     "https://skyops.yourcompany.com/api/v1/integrations/webhooks/<webhook-id>/deliveries"
   ```
2. Check the recorded `httpStatus` and `errorMessage`:
   - `ECONNREFUSED` / `ENOTFOUND`: Target endpoint hostname is invalid or blocked by firewall.
   - `401 Unauthorized` / `403 Forbidden`: The target endpoint is rejecting the `X-SkyOps-Signature` HMAC header. Verify the shared secret matches between SkyOps and your receiving endpoint.
   - `504 Gateway Timeout`: The receiving webhook receiver took $> 5$ seconds to respond. Ensure your receiver acknowledges requests asynchronously.
