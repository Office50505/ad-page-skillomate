# Skillomate Checkout

A mobile-first Skillomate subscription flow with:

- Autoplay course preview video
- ₹1 introductory offer for 24 hours
- Phone number and demo OTP verification
- UPI payment-method interface
- ₹499/month renewal disclosure
- Local Node.js backend for authentication and payment demos

## Run locally

```bash
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

## Demo flow

1. Select **Subscribe for ₹1**.
2. Enter a valid 10-digit Indian mobile number.
3. Use the demo OTP displayed in the sign-in dialog.
4. Continue to the payment screen and select **Pay ₹1**.

The current OTP and payment services are local demonstrations. Connect a production SMS provider and payment gateway before deploying a live checkout.
