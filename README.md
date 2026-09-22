# Skillomate ad onboarding

Connected to the existing Skillomate backend. The old demo OTP and simulated payment endpoints have been removed.

The landing-page preview streams Skillomate's real **AI Influencer Course - Introduction** lesson from the existing CloudFront HLS source. Safari uses native HLS and Chrome uses Hls.js.

## Local test

- Ad landing page: http://localhost:5174
- Main signup frontend: http://localhost:5173
- Skillomate API: http://127.0.0.1:3000

Start the Skillomate API and frontend using their usual commands. In this folder run `npm start`.

The ad server proxies only approved API paths. Defaults are `SKILLOMATE_API_ORIGIN=http://127.0.0.1:3000` and `SKILLOMATE_APP_ORIGIN=http://localhost:5173`. Set both explicitly for production. No secrets belong in this repo.

The main backend uses `AD_PAYMENT_MODE=test` by default outside production, independently of the main website's billing mode. Production requires explicit `AD_PAYMENT_MODE=test` or `live`. It needs matching Razorpay credentials, webhook secret and monthly plan for that mode. The local sandbox monthly plan was corrected to ₹499; live settings were not changed.

1. Use a mobile number not already registered in Skillomate.
2. Click Subscribe, enter the phone and the real MSG91 OTP.
3. Read and accept the renewal terms in the OTP form. Successful OTP verification opens Razorpay immediately; there is no intermediate payment page.
4. Complete Razorpay's test checkout. Sandbox payments are not real UPI mandates; real device handoff needs a later live validation.
5. After backend payment verification, the main signup page opens directly at profile details. Complete the form and start learning.

This implementation uses documented Razorpay Standard Checkout with a handler, not an unverified redirect from a generic hosted short link. Failed/pending payments stay on the ad page with status recovery controls. The checkout can be cancelled without completing signup. Existing users get a sign-in link and cannot create duplicate accounts through this funnel.

OTP and payment are separate: OTP sends real SMS; ad checkout currently uses Razorpay test mode. No SMS or payment was initiated by the implementation verification. Auth/session tokens stay out of URLs; the signup return carries only an expiring, single-use handoff code in the fragment.

## Resume

The ad session lasts one hour. Refresh preserves it in sessionStorage. Use Check payment status / finish signup after an interrupted return. After the session expires, verify the same phone again; the persisted onboarding identity preserves the billing association. A paid signup handoff lasts five minutes and the profile completion authorization lasts thirty minutes. Reloading profile setup within its validity does not require another OTP.

## Verification

Automated tests cover token forgery, expiry, handoff replay, payment pending, reserved identity, paid signup and frontend profile resume. HTTP smoke checks cover configuration/proxy and unauthenticated rejection. Rendered mobile/browser, real SMS delivery and a full provider transaction were not performed by the agent. See the main repository's output/pdf/skillomate-ad-onboarding.pdf report.
