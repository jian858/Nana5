/* =====================================================================
   FORGOT PASSWORD
   ===================================================================== */
function openForgotPassword() {
  if (forgotOverlay) return;
  if (location.hash !== '#forgot-password') history.pushState(null, '', '#forgot-password');

  const overlay = document.createElement('div');
  forgotOverlay = overlay;
  document.body.style.overflow = 'hidden';
  overlay.className = 'screen-forgot';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'forgot-title');
  overlay.innerHTML = `
    <aside class="forgot-side">
      <div class="brand-row"><span class="brand-mark" aria-hidden="true"></span><span>Murmur</span></div>
      <div>
        <h2>Locked out? It happens.</h2>
        <p>Enter the email you signed up with. Murmur will check your account before sending a reset link.</p>
      </div>
      <span></span>
    </aside>
    <section class="forgot-main" role="tabpanel" aria-labelledby="forgot-tab-reset">
      <div class="forgot-top">
        <nav class="forgot-tabs" role="tablist" aria-label="Account access">
          <button type="button" class="forgot-tab" role="tab" aria-selected="false" data-forgot-login>Log in</button>
          <button type="button" class="forgot-tab active" id="forgot-tab-reset" role="tab" aria-selected="true">Forgot password</button>
        </nav>
        <button class="close-btn" type="button" aria-label="Close and go back to login">×</button>
      </div>
      <div class="forgot-body">
        <div class="forgot-content">
          <h3 id="forgot-title">Reset your password</h3>
          <p data-forgot-intro>We'll check your account first, then send a reset link if it is eligible.</p>
          <div class="field">
            <label for="forgot-email">Email address</label>
            <input id="forgot-email" type="email" autocomplete="email" placeholder="you@example.com" />
          </div>
          <div class="forgot-loading" data-forgot-loading hidden role="status" aria-live="polite">
            <span class="forgot-spinner" aria-hidden="true"></span>
            <span>Checking your account…</span>
          </div>
          <div class="error" role="alert" aria-live="polite" data-forgot-error></div>
          <div class="forgot-success" data-forgot-success hidden role="status" aria-live="polite"></div>
          <button class="btn primary" type="button" data-forgot-send>Check account and send link</button>
          <button class="btn ghost" type="button" data-forgot-back>Back to login</button>
        </div>
      </div>
    </section>
  `;
  document.body.appendChild(overlay);

  const $ = sel => overlay.querySelector(sel);
  const emailInput = $('#forgot-email');
  const errorBox = $('[data-forgot-error]');
  const successBox = $('[data-forgot-success]');
  const loading = $('[data-forgot-loading]');
  const sendBtn = $('[data-forgot-send]');
  emailInput.value = (document.getElementById('email').value || '').trim();

  async function send() {
    const email = emailInput.value.trim();
    errorBox.textContent = '';
    successBox.hidden = true;
    if (!email) { errorBox.textContent = 'Add your email address first.'; return; }
    if (!isValidEmail(email)) { errorBox.textContent = 'Email is not valid. Please enter a valid email address.'; return; }

    sendBtn.disabled = true;
    emailInput.disabled = true;
    sendBtn.textContent = 'Checking account…';
    loading.hidden = false;
    try {
      const response = await fetch(MURMUR_SUPABASE_URL + '/functions/v1/murmur-password-reset-check', {
        method: 'POST',
        headers: { 'apikey': MURMUR_SUPABASE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.status) {
        throw new Error(result.message || 'We could not check this account. Please try again.');
      }

      if (result.status !== 'eligible') {
        successBox.textContent = result.message || 'This account is not eligible for a password reset.';
        successBox.hidden = false;
        sendBtn.textContent = 'Check again';
        return;
      }

      sendBtn.textContent = 'Sending reset link…';
      if (!window.murmurSupabase) throw new Error('Account services are still loading. Please try again.');
      if (!window.MurmurSupabaseAuth?.resetPassword) throw new Error('Supabase account services are still loading. Please try again.');
      await window.MurmurSupabaseAuth.resetPassword(email);
      successBox.textContent = 'Your Murmur account is eligible. A password reset email has been sent. Check your inbox and spam folder.';
      successBox.hidden = false;
      sendBtn.textContent = 'Send again';
    } catch (error) {
      const code = String(error && error.code || '');
      console.error('Password reset check/send failed:', code || (error && error.message));
      const resetMessages = {
        'invalid_email': 'Email is not valid. Please enter a valid email address.',
        'AuthApiError': 'We could not send the reset link. Please try again or contact Murmur support.'
      };
      errorBox.textContent = resetMessages[code] || friendlyError(error, 'We could not send the reset link. Please try again.');
      sendBtn.textContent = 'Try again';
    } finally {
      loading.hidden = true;
      sendBtn.disabled = false;
      emailInput.disabled = false;
    }
  }

  sendBtn.addEventListener('click', send);
  $('[data-forgot-back]').addEventListener('click', () => closeForgotPassword(false));
  $('[data-forgot-login]').addEventListener('click', () => closeForgotPassword(false));
  $('.close-btn').addEventListener('click', () => closeForgotPassword(false));
  overlay.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeForgotPassword(false);
    if (e.key === 'Enter' && e.target === emailInput) { e.preventDefault(); send(); }
  });
  emailInput.addEventListener('input', () => { errorBox.textContent = ''; successBox.hidden = true; });
  setTimeout(() => emailInput.focus(), 30);
}

/* ---------- Privacy Policy, Cookie Policy and cookie notice ---------- */
// Replace with the address people should write to about their data.
const PRIVACY_CONTACT = 'privacy@example.com';
const POLICY_UPDATED = 'November 1, 2026';
const COOKIE_NOTICE_KEY = 'murmur-cookie-notice';
