const $ = selector => document.querySelector(selector);
const offer = $('[data-offer-gate]'), modal = $('[data-auth-modal]');
const phoneForm = $('[data-phone-form]'), otpForm = $('[data-otp-form]');
const phone = $('#phone-number'), otp = $('#otp-code'), authStatus = $('[data-auth-status]'), otpStatus = $('[data-otp-status]');
const status = $('[data-payment-status]'), recovery = $('[data-checkout-recovery]');
const enterCheckout = $('[data-enter-checkout]');
const video = $('[data-preview-video]');
const previewPlay = $('[data-preview-play]');
const previewProgress = $('[data-video-progress]');
let bearer = sessionStorage.getItem('skillomateAdSession') || '', pricing, appOrigin, busy = false, checkoutOpen = false;
let paymentType = 'trial';
const previewSource = video?.dataset.hlsSrc;
if (video) { video.muted = true; video.defaultMuted = true; }
function startPreview() {
  if (!video) return;
  video.autoplay = true;
  video.play().then(() => {
    previewPlay.hidden = true;
  }).catch(() => {
    previewPlay.hidden = false;
  });
}
if (video && previewSource) {
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = previewSource;
    video.addEventListener('loadedmetadata', startPreview, { once: true });
  } else if (window.Hls?.isSupported()) {
    const previewHls = new window.Hls({ enableWorker: true, lowLatencyMode: false, autoStartLoad: true, startPosition: 0 });
    previewHls.on(window.Hls.Events.MANIFEST_PARSED, startPreview);
    previewHls.on(window.Hls.Events.FRAG_BUFFERED, startPreview);
    previewHls.on(window.Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      previewPlay.hidden = false;
      if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) previewHls.startLoad();
      else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) previewHls.recoverMediaError();
    });
    previewHls.loadSource(previewSource);
    previewHls.attachMedia(video);
  } else {
    previewPlay.hidden = false;
  }
  video.addEventListener('loadeddata', startPreview, { once: true });
  video.addEventListener('canplay', startPreview, { once: true });
  video.addEventListener('playing', () => { previewPlay.hidden = true; });
  video.addEventListener('pause', () => { if (!modal || modal.hidden) previewPlay.hidden = false; });
  video.addEventListener('timeupdate', () => {
    if (previewProgress && Number.isFinite(video.duration) && video.duration > 0) {
      previewProgress.style.width = `${Math.min(100, (video.currentTime / video.duration) * 100)}%`;
    }
  });
}
previewPlay?.addEventListener('click', startPreview);
async function api(url, body, authorized = false) {
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: `Bearer ${bearer}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.message || 'Request failed. Please retry.');
  return data;
}
function showRecovery(message) {
  offer.hidden = false;
  enterCheckout.hidden = true;
  recovery.hidden = false;
  status.textContent = message;
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}
async function openRazorpayCheckout() {
  if (busy || checkoutOpen) return;
  busy = true;
  modal.hidden = true;
  video?.pause();
  try {
    [pricing, { appOrigin }] = await Promise.all([api('/api/onboarding/config'), api('/ad-config')]);
    const state = await api('/api/onboarding/status', undefined, true);
    paymentType = state.trialEligible === false ? 'monthly' : 'trial';
    if (state.accessGranted) return await finish();
    if (pricing.gateway !== 'razorpay') throw new Error('Razorpay checkout is unavailable. Please retry later.');
    if (!window.Razorpay) throw new Error('Razorpay could not load. Reload this page.');
    const data = await api('/api/onboarding/checkout', { paymentType, mandateConsent: true }, true);
    const prefill = Object.fromEntries(Object.entries(data.prefill || {}).filter(([, value]) => typeof value === 'string' && value.trim()).map(([key, value]) => [key, value.trim()]));
    const digits = String(prefill.contact || '').replace(/\D/g, '');
    if (digits) prefill.contact = `+${digits.length === 10 ? '91' : ''}${digits}`;
    const gateway = new window.Razorpay({
      key: data.keyId,
      subscription_id: data.subscriptionId,
      name: 'Skillomate',
      description: paymentType === 'trial' ? '₹1 for 24 hours, then ₹499/month' : '₹499/month subscription',
      prefill,
      readonly: { contact: Boolean(prefill.contact) },
      hidden: { contact: Boolean(prefill.contact), email: true },
      theme: { color: '#C58B2A' },
      handler: async result => {
        checkoutOpen = false;
        try {
          showRecovery('Verifying payment…');
          const verified = await api('/api/onboarding/verify', result, true);
          if (verified.accessGranted) await finish();
          else showRecovery('Payment confirmation is pending. Check payment status; do not pay again.');
        } catch (error) {
          showRecovery(`${error.message} Check payment status before retrying.`);
        }
      },
      modal: {
        ondismiss: () => {
          checkoutOpen = false;
          showRecovery('Razorpay checkout was closed. You can reopen it or check payment status.');
        },
      },
    });
    gateway.on('payment.failed', () => showRecovery('Payment was unsuccessful. Retry in Razorpay or check payment status.'));
    checkoutOpen = true;
    gateway.open();
  } catch (error) {
    showRecovery(error.message);
  } finally {
    busy = false;
  }
}
function openPhone() { modal.hidden = false; phoneForm.hidden = false; otpForm.hidden = true; authStatus.textContent = ''; video?.pause(); phone.focus(); }
enterCheckout.onclick = () => bearer ? openRazorpayCheckout() : openPhone();
$('[data-auth-close]').onclick = () => { modal.hidden = true; };
$('[data-otp-back]').onclick = openPhone;
phone.oninput = () => { phone.value = phone.value.replace(/\D/g, '').slice(0, 10); };
otp.oninput = () => { otp.value = otp.value.replace(/\D/g, '').slice(0, 6); };
async function send(resend = false) {
  if (busy) return; busy = true;
  authStatus.textContent = 'Sending OTP…'; otpStatus.textContent = 'Sending OTP…';
  try {
    await api(`/api/auth/${resend ? 'resend-mobile-otp' : 'send-mobile-otp'}`, { mobileNumber: `+91${phone.value}` });
    $('[data-phone-preview]').textContent = `+91 ${phone.value}`;
    phoneForm.hidden = true; otpForm.hidden = false; otpStatus.textContent = 'Enter the OTP sent to your phone.'; otp.focus();
  } catch (error) { authStatus.textContent = otpStatus.textContent = error.message; }
  finally { busy = false; }
}
phoneForm.onsubmit = e => { e.preventDefault(); send(); };
$('[data-resend-otp]').onclick = () => send(true);
otpForm.onsubmit = async e => {
  e.preventDefault(); if (busy) return; busy = true; otpStatus.textContent = 'Verifying…';
  try {
    const proof = await api('/api/auth/verify-mobile-otp', { mobileNumber: `+91${phone.value}`, mobileOtp: otp.value });
    const session = await api('/api/onboarding/session', { signupToken: proof.signupToken });
    bearer = session.token; sessionStorage.setItem('skillomateAdSession', bearer);
    busy = false;
    await openRazorpayCheckout();
  } catch (error) { otpStatus.textContent = error.message; }
  finally { busy = false; }
};
async function finish() {
  const result = await api('/api/onboarding/handoff', {}, true);
  if (!appOrigin) ({ appOrigin } = await api('/ad-config'));
  // One-use short-lived code in fragment, never phone/OTP/auth token in the URL.
  window.location.assign(`${appOrigin}/signup#onboarding=${encodeURIComponent(result.code)}`);
}
$('[data-retry-payment]').onclick = openRazorpayCheckout;
$('[data-check-payment]').onclick = async () => { if (busy || checkoutOpen) return; busy = true; try { await finish(); } catch (error) { status.textContent = error.message; } finally { busy = false; } };
$('[data-cancel-mandate]').onclick = async () => {
  if (busy || checkoutOpen || !window.confirm('Cancel automatic renewal for this checkout?')) return;
  busy = true;
  try { await api('/api/onboarding/cancel', {}, true); status.textContent = 'Auto-renewal cancelled. Paid access remains until expiry.'; } catch (error) { status.textContent = error.message; }
  finally { busy = false; }
};
const muteButton = $('[data-mute-button]');
function syncPreviewSound() {
  muteButton.classList.toggle('is-unmuted', !video.muted);
  muteButton.setAttribute('aria-label', video.muted ? 'Unmute preview' : 'Mute preview');
}
video.addEventListener('volumechange', syncPreviewSound);
$('.preview-player').style.cursor = 'pointer';
document.addEventListener('click', (event) => {
  if (busy || checkoutOpen || !modal.hidden || !(event.target instanceof Element)) return;
  if (!event.target.closest('.preview-player') && event.target.closest('button, a, input, textarea, select, label, [role="dialog"], [role="button"], [contenteditable="true"]')) return;
  video.muted = !video.muted;
  syncPreviewSound();
  if (video.paused) startPreview();
});
startPreview();

$('[data-reverify]').onclick = () => { bearer = ''; sessionStorage.removeItem('skillomateAdSession'); recovery.hidden = true; enterCheckout.hidden = false; openPhone(); };

api('/ad-config').then(config => { appOrigin = config.appOrigin; $('[data-existing-login]').href = `${appOrigin}/login`; }).catch(() => {});
