const offerGate = document.querySelector("[data-offer-gate]");
const checkoutApp = document.querySelector("[data-checkout-app]");
const previewVideo = document.querySelector("[data-preview-video]");
const muteButton = document.querySelector("[data-mute-button]");
const paymentRows = document.querySelectorAll("[data-method]");
const qrMethod = document.querySelector("[data-qr-method]");
const qrToggle = document.querySelector("[data-qr-toggle]");
const qrBody = document.querySelector("[data-qr-body]");
const payButton = document.querySelector("[data-pay-button]");
const payLabel = document.querySelector("[data-pay-label]");
const paymentStatus = document.querySelector("[data-payment-status]");
const modal = document.querySelector("[data-modal]");
const transactionId = document.querySelector("[data-transaction-id]");
const authModal = document.querySelector("[data-auth-modal]");
const phoneForm = document.querySelector("[data-phone-form]");
const otpForm = document.querySelector("[data-otp-form]");
const phoneInput = document.querySelector("#phone-number");
const otpInput = document.querySelector("#otp-code");
const authStatus = document.querySelector("[data-auth-status]");
const otpStatus = document.querySelector("[data-otp-status]");
const phonePreview = document.querySelector("[data-phone-preview]");
const demoOtp = document.querySelector("[data-demo-otp]");
let selectedMethod = "QR";
let challengeId = "";
let verifiedPhone = "";
let authToken = "";

previewVideo?.play().catch(() => {});

muteButton?.addEventListener("click", () => {
  previewVideo.muted = !previewVideo.muted;
  muteButton.classList.toggle("is-unmuted", !previewVideo.muted);
  muteButton.setAttribute("aria-label", previewVideo.muted ? "Unmute preview" : "Mute preview");
});

function showCheckout() {
  previewVideo?.pause();
  offerGate.hidden = true;
  checkoutApp.hidden = false;
  window.scrollTo({ top: 0, behavior: "auto" });
}

function openSignIn() {
  previewVideo?.pause();
  authModal.hidden = false;
  phoneForm.hidden = false;
  otpForm.hidden = true;
  authStatus.textContent = "";
  setTimeout(() => phoneInput.focus(), 0);
}

function closeSignIn() {
  authModal.hidden = true;
  previewVideo?.play().catch(() => {});
}

function showOffer() {
  checkoutApp.hidden = true;
  offerGate.hidden = false;
  window.scrollTo({ top: 0, behavior: "auto" });
  previewVideo?.play().catch(() => {});
}

document.querySelector("[data-enter-checkout]")?.addEventListener("click", () => {
  if (authToken) showCheckout();
  else openSignIn();
});
document.querySelector("[data-payment-back]")?.addEventListener("click", showOffer);
document.querySelector("[data-auth-close]")?.addEventListener("click", closeSignIn);

phoneInput?.addEventListener("input", () => {
  phoneInput.value = phoneInput.value.replace(/\D/g, "").slice(0, 10);
});

otpInput?.addEventListener("input", () => {
  otpInput.value = otpInput.value.replace(/\D/g, "").slice(0, 6);
});

async function requestOtp() {
  verifiedPhone = phoneInput.value.replace(/\D/g, "");
  authStatus.textContent = "Sending OTP...";
  try {
    const response = await fetch("/api/auth/send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: verifiedPhone }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Could not send OTP.");

    challengeId = result.challengeId;
    phonePreview.textContent = `+91 ${verifiedPhone.slice(0, 5)} ${verifiedPhone.slice(5)}`;
    demoOtp.textContent = `Demo OTP: ${result.demoOtp}`;
    phoneForm.hidden = true;
    otpForm.hidden = false;
    otpStatus.textContent = "";
    otpInput.value = "";
    setTimeout(() => otpInput.focus(), 0);
  } catch (error) {
    authStatus.textContent = error.message;
  }
}

phoneForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  await requestOtp();
});

otpForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  otpStatus.textContent = "Verifying OTP...";
  try {
    const response = await fetch("/api/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeId, otp: otpInput.value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "OTP verification failed.");

    authToken = result.authToken;
    authModal.hidden = true;
    showCheckout();
  } catch (error) {
    otpStatus.textContent = error.message;
  }
});

document.querySelector("[data-otp-back]")?.addEventListener("click", () => {
  otpForm.hidden = true;
  phoneForm.hidden = false;
  authStatus.textContent = "";
  phoneInput.focus();
});

document.querySelector("[data-resend-otp]")?.addEventListener("click", async () => {
  otpForm.hidden = true;
  phoneForm.hidden = false;
  await requestOtp();
});

authModal?.addEventListener("click", (event) => {
  if (event.target === authModal) closeSignIn();
});

paymentRows.forEach((row) => {
  row.addEventListener("click", () => {
    selectedMethod = row.dataset.method;
    paymentRows.forEach((item) => item.classList.toggle("selected", item === row));
    qrMethod.classList.remove("selected");
    paymentStatus.textContent = `${selectedMethod} selected. Tap Pay ₹1 to continue.`;
  });
});

qrToggle?.addEventListener("click", () => {
  const isOpen = qrToggle.getAttribute("aria-expanded") === "true";
  qrToggle.setAttribute("aria-expanded", String(!isOpen));
  qrBody.hidden = isOpen;
  qrMethod.classList.toggle("selected", !isOpen);
  qrToggle.querySelector(".row-arrow").textContent = isOpen ? "⌄" : "⌃";
  if (!isOpen) {
    selectedMethod = "QR";
    paymentRows.forEach((item) => item.classList.remove("selected"));
  }
});

payButton?.addEventListener("click", async () => {
  payButton.disabled = true;
  payLabel.textContent = "Processing...";
  paymentStatus.textContent = "Connecting securely to Skillomate...";

  try {
    const response = await fetch("/api/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        planId: "skillomate-monthly-trial",
        amount: 1,
        renewalAmount: 499,
        method: selectedMethod,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Payment could not be completed.");

    transactionId.textContent = `Transaction ID: ${result.transactionId}`;
    paymentStatus.textContent = "Payment confirmed. Your trial is active.";
    modal.hidden = false;
  } catch (error) {
    paymentStatus.textContent = error.message || "Something went wrong. Please try again.";
  } finally {
    payButton.disabled = false;
    payLabel.textContent = "Pay ₹1";
  }
});

document.querySelectorAll("[data-close-modal]").forEach((button) => {
  button.addEventListener("click", () => { modal.hidden = true; });
});

modal?.addEventListener("click", (event) => {
  if (event.target === modal) modal.hidden = true;
});
