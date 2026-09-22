# Ad page → verified phone → Razorpay AutoPay → profile completion

Status: initial local integration implemented. See README.md for the actual supported checkout, test mode, ports and verification limits. The architecture below records the original plan; the implementation reserves a final User ID in OnboardingSession and reuses existing billing reconciliation instead of changing billing ownership schemas.
Repository: https://github.com/Office50505/ad-page-skillomate
Inspected revision: 09fa041 (first commit).
Local checkout: /Users/zohershakir/Desktop/edunex-ai/ad page
Main application baseline: d172b1d plus existing uncommitted local fixes.

## Intended customer journey

Ad landing page → Subscribe CTA → mobile number → real OTP verification → Razorpay subscription/mandate authorization → Skillomate verification/return page → existing signup profile-details screen → authenticated learning experience.

No second OTP during a valid, continuous verified onboarding session. The main signup UI calls the profile-details screen step 3 internally; the customer experiences it as the second part after phone verification.

The ad repository advertises a one-time ₹1 / 24-hour trial followed by ₹499/month AutoPay. Keep this offer unless the business changes it. Show actual charge, renewal amount/frequency and cancellation terms before checkout. A previously used trial must produce the monthly offer with explicit acceptance, never an unexpected charge. Annual is outside this ad funnel; latest main backend removed annual checkout support.

## Findings from the actual code

- index.html/styles.css/script.js: standalone mobile-first landing page, preview video, phone/OTP dialog and payment UI.
- server.js: demo-only OTPs and sessions stored in memory. /api/auth/send-otp exposes demoOtp; /api/payments returns status paid without contacting a payment provider. Neither can be used as proof of verification/payment in production.
- Main edunex-b/routes/auth.js: OTP verification returns a signup token valid for 10 minutes. Existing signup requires profile name and password before it creates a User. Existing send/verify signup OTP endpoints reject registered mobile numbers.
- Main edunex-b/routes/payment.js: initiation and verification require an authenticated User. Ad OTP verification alone cannot call these endpoints today.
- Main edunex-b/controllers/razorpayController.js and services/trialEligibility.js: reuse existing subscription reconciliation and one-time-trial checks, adapted for onboarding.
- Main edunex-f/src/pages/SignupPage.jsx: OTP success currently stores signupToken in React memory and opens step 3. This memory will not survive gateway navigation.

## Proposed architecture

Keep the ad frontend repository separate. Use the existing Skillomate backend as the authority for OTP, onboarding and billing; do not deploy a second demo auth/payment backend.

Introduce a persisted OnboardingSession containing normalized verified phone, OTP verification time, expiry, purpose, selected server-side offer, Razorpay subscription/payment references, payment state, eventual user ID and completion/consumption timestamps. Store opaque session-token hashes, not raw OTPs. Keep campaign attribution separate from authentication. This avoids inventing dummy names/passwords or creating unrestricted user accounts before profile completion.

Recommended hosting: landing page under the Skillomate origin, e.g. /offer/, with /api routed to the main backend. If a separate domain is required, use an expiring single-use handoff redeemed by the main backend; do not depend on cross-domain localStorage or third-party cookies. Do not place phone numbers, OTPs or reusable auth/signup JWTs in URLs. Allowlist return paths.

### 1. Real phone verification

Add onboarding-scoped send/resend/verify endpoints using the existing MSG91 OTP service, normalization, expiry, attempt limits and rate limiting. On successful OTP validation create/rotate the onboarding session, preferably carried by Secure HttpOnly cookies with appropriate SameSite and CSRF controls. Demo OTP display and in-memory demo verification must be removed from the production path.

Check existing users after verification: reuse the established identity via an explicit verified-phone session flow; do not create duplicates. Already subscribed users should go to learning. Existing users with complete profiles do not need signup again. Trial eligibility comes from backend history.

### 2. Create and persist the subscription

An onboarding-scoped checkout endpoint accepts only a server-recognized offer and explicit mandate consent. It validates the verified session, applies trial eligibility, and durably associates a unique Razorpay subscription with the session before navigation. Repeated clicks/retries reuse a valid pending checkout; use a creation lease/idempotency strategy and reconcile uncertain provider responses.

Refactor billing reconciliation to resolve ownership to either an onboarding session or an existing User. Current billing records are user-bound, so new onboarding ownership must be deliberate and tested. Webhooks may arrive before a User exists and must not be dropped. Premium access requires backend-confirmed payment/entitlement, not just a browser success flag or mandate-created state.

### 3. Razorpay-hosted checkout and return

For this ad funnel the requested hosted Razorpay handoff is intentional. Use a subscription authorization flow, not a one-time Payment Link. Official subscription creation returns a short_url; however that alone does not establish configurable automatic return to the profile screen.

Implementation prerequisite: validate the exact supported hosted-subscription return/callback mechanism in test mode and on the merchant account. If the hosted short_url cannot guarantee the required automatic return, confirm a supported Standard Checkout redirect/callback integration as the alternative before finalizing this portion. Do not promise an unsupported redirect parameter. Custom S2S inline AutoPay activation is not the assumed integration here.

On return, use a Skillomate-owned verification route. Validate any provider signature against the stored expected subscription and verify provider status server-side. Signed webhooks and reconciliation handle lifecycle changes, pending states and lost browser returns. Distinguish mandate authorization, initial charge, trial entitlement and subsequent paid renewal. Never grant access from query parameters. Browser callback and webhooks must be idempotent and work in either order.

### 4. Resume profile details without another OTP

After backend confirmation, issue/exchange a short-lived, purpose-bound completion authorization tied to the verified phone and subscription. SignupPage asks the backend to resume the session and opens its profile screen with the phone fixed/read-only. Reuse the existing name/password/age/gender/avatar form and validation.

Profile completion atomically creates or associates the User, transfers billing ownership/entitlement, consumes the completion authorization and creates a normal authenticated session. Handle duplicate-phone races safely. Do not pass the existing 10-minute signup JWT through a long checkout; retain verified state in the persisted session and derive completion authority when returning.

If the user paid but leaves before profile completion, retain the payment/session association and provide a recovery flow. If the session expires or the user changes devices, re-verifying the phone may be necessary to establish ownership; never charge again merely to finish signup. Provide access to mandate management/cancellation even if profile setup remains incomplete.

## Failure and resume behaviour

Wrong/expired OTP: visible validation and resend controls. Gateway cancel/failure: return to the offer and retry safely. Verification pending: show Checking payment with status retry; do not create another mandate. Successful payment but lost callback: resume via persisted session and webhooks. Expired completion link: recover by proving phone ownership. Refresh/back/multiple tabs: resume one server-owned checkout without duplicate charges.

## Implementation order and affected areas

1. Confirm domain/path, advertised trial terms, existing-user routing and supported hosted return mechanism.
2. Add onboarding persistence/routes; integrate real OTP and protected resume/complete operations.
3. Adapt razorpayController and billing ownership/webhooks for pre-profile sessions while retaining normal authenticated checkout.
4. Replace demo API calls in ad script.js; show server-driven eligibility/pricing and gateway handoff.
5. Add main app return route and signup resume/profile-completion integration.
6. Add conversion events (CTA, OTP verified, checkout started, payment verified, profile completed), deduplicated and without sending OTP/auth secrets or raw phone numbers to analytics.
7. Run automated and sandbox tests, then deploy frontend/backend together with explicit route/config readiness.

## Acceptance checks, especially mobile

- New eligible user: ₹1 trial + mandate → verified return → profile form, no repeated OTP.
- Existing/trial-used/active subscriber cases, duplicate-phone races and duplicate callbacks.
- Forged callbacks, mismatched subscription, expired/replayed handoff cannot create access.
- Webhook before return, return before webhook, pending/failure/cancel and abandoned paid signup recover correctly.
- Android Chrome UPI Intent, iOS Safari supported UPI handoff and desktop QR tested on real supported devices; no promise of app behaviour based on desktop mocks.
- Narrow mobile widths, keyboard, OTP autofill/paste, visible consent, sticky CTA, slow network and browser back tested.
- No demo success path, no duplicate mandate on retry and no change to Android Play Billing/iOS IAP.

## Reference

Razorpay subscription creation (including returned short_url):
https://raw.githubusercontent.com/razorpay/markdown-docs/master/api/payments/subscriptions/create-subscription.md

Implementation update: local integration completed after approval. A sandbox-only ₹499 monthly plan was created and the ignored local test-plan setting updated. No SMS, customer subscription, payment, push or production deployment was performed.
