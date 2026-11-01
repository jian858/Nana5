(() => {
  'use strict';

  const SUPABASE_URL = 'https://pkadftvqslkykehcqedj.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_etoHiUGbJ96MUPzJABL12A_UiTWVxok';
  const API = SUPABASE_URL + '/auth/v1';
  const $ = id => document.getElementById(id);
  const sections = ['loading', 'setup', 'done', 'failure'];
  let accessToken = '';
  let refreshToken = '';

  function show(section) {
    sections.forEach(id => { $(id).hidden = id !== section; });
  }
  function message(text, kind) {
    const el = $('status');
    el.textContent = text || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }
  function clearSecretsFromAddressBar() {
    try { history.replaceState(null, document.title, location.pathname + location.search); } catch (_) {}
  }
  async function authRequest(path, options = {}) {
    const response = await fetch(API + path, {
      ...options,
      headers: {
        apikey: SUPABASE_KEY,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = data.msg || data.message || data.error_description || data.error || 'Authentication request failed.';
      throw new Error(String(error));
    }
    return data;
  }
  async function getValidAccessToken() {
    if (!accessToken || !refreshToken) throw new Error('The invitation is missing its session details. Request a new invitation.');
    try {
      await authRequest('/user', { headers: { Authorization: 'Bearer ' + accessToken } });
      return accessToken;
    } catch (error) {
      const refreshed = await authRequest('/token?grant_type=refresh_token', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: refreshToken })
      });
      accessToken = refreshed.access_token || '';
      refreshToken = refreshed.refresh_token || refreshToken;
      if (!accessToken) throw error;
      return accessToken;
    }
  }
  async function start() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    const type = params.get('type');
    accessToken = params.get('access_token') || '';
    refreshToken = params.get('refresh_token') || '';
    // Never leave invitation tokens in browser history or the visible address bar.
    clearSecretsFromAddressBar();

    if (type !== 'invite' || !accessToken || !refreshToken) {
      throw new Error('This is not a complete invitation link. Open the newest invitation email or request a new one.');
    }
    await getValidAccessToken();
    show('setup');
    message('Invitation verified. Choose a password of at least 8 characters.', 'success');
    $('password').focus();
  }

  $('passwordForm').addEventListener('submit', async event => {
    event.preventDefault();
    const password = $('password').value;
    const confirmation = $('confirmPassword').value;
    if (password.length < 8) return message('Use at least 8 characters for your password.', 'error');
    if (password !== confirmation) return message('The passwords do not match.', 'error');

    const button = $('submitButton');
    button.disabled = true;
    button.textContent = 'Saving…';
    message('Saving your password securely…');
    try {
      const token = await getValidAccessToken();
      await authRequest('/user', {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + token },
        body: JSON.stringify({ password })
      });
      // End the one-time invitation session after the password has been set.
      try {
        await authRequest('/logout', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token },
          body: JSON.stringify({ scope: 'local' })
        });
      } catch (_) {}
      accessToken = '';
      refreshToken = '';
      $('password').value = '';
      $('confirmPassword').value = '';
      show('done');
      message('Your invitation has been accepted.', 'success');
    } catch (error) {
      message(error.message || 'Could not set your password. Request a new invitation if this link has expired.', 'error');
      button.disabled = false;
      button.textContent = 'Set password';
    }
  });

  start().catch(error => {
    show('failure');
    $('failureMessage').textContent = error.message || 'This invitation link is invalid or has expired.';
    message(error.message || 'Invitation verification failed.', 'error');
  });
})();