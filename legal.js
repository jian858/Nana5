/* =====================================================================
   LEGAL PAGES  -  terms, privacy, cookies
   ===================================================================== */
const LEGAL_HASHES = { '#privacy': 'privacy', '#cookies': 'cookies', '#terms': 'terms' };

const LEGAL_PAGES = {
  terms: () => `
    <h1>Terms of Service</h1>
    <p class="legal-meta">Last updated: ${POLICY_UPDATED}</p>
    <p>These terms govern your use of Murmur. By creating an account or using Murmur you agree to them.</p>
    <h2>1. Who can use Murmur</h2>
    <p>You must be at least 13 years old and give accurate information when you sign up. You are responsible for your account and for keeping your password private.</p>
    <h2>2. Your content</h2>
    <p>You own what you post. You give Murmur permission to store and show it to other users so the service can work. Only post things you have the right to share.</p>
    <h2>3. Acceptable use</h2>
    <ul>
      <li>No harassment, hate, threats or sexual content involving minors.</li>
      <li>No spam, scams, impersonation or illegal content.</li>
      <li>No attempts to break, overload or get around the security of Murmur.</li>
    </ul>
    <p>We may remove content or suspend accounts that break these rules.</p>
    <h2>4. Ending your account</h2>
    <p>You can delete your account at any time from inside the app. We may suspend or end accounts that break these terms.</p>
    <h2>5. No guarantees</h2>
    <p>Murmur is provided "as is". We try to keep it running but cannot promise it will always be available or error-free. To the extent the law allows, we are not liable for indirect or lost-data damages.</p>
    <h2>6. Privacy</h2>
    <p>How we handle your information is explained in the <a href="#privacy">Privacy Policy</a> and <a href="#cookies">Cookie Policy</a>.</p>
    <h2>7. Changes and contact</h2>
    <p>We may update these terms and will change the date above when we do. Questions? Email <a href="mailto:${PRIVACY_CONTACT}">${PRIVACY_CONTACT}</a>.</p>
  `,

  privacy: () => `
    <h1>Privacy Policy</h1>
    <p class="legal-meta">Last updated: ${POLICY_UPDATED}</p>
    <p>This policy explains what personal information Murmur ("Murmur", "we", "us") collects, how we use it, who we share it with, and the choices you have. By creating an account or using Murmur you agree to it.</p>

    <h2>1. Information we collect</h2>
    <h3>Information you give us</h3>
    <ul>
      <li><strong>Account details:</strong> your first, middle and last name, username, email address and password. Your password is handled by Firebase Authentication. We never see it in readable form.</li>
      <li><strong>Birthday:</strong> used to check that you are at least 13 years old.</li>
      <li><strong>Optional profile details:</strong> gender, location, school, phone number, bio, interests and profile or cover photos, if you add them.</li>
    </ul>
    <h3>Information created as you use Murmur</h3>
    <p>Your posts, stories, comments, likes, friend connections, chats, reactions and notifications are stored in Firebase Realtime Database so they can sync between your devices and friends. Photos and videos you upload may be stored in Firebase Storage. Limited interface preferences and cached app state are kept in your browser storage.</p>
    <h3>Technical information</h3>
    <p>Our service providers record sign-in information such as your account ID and when you created your account and last signed in. They also process technical data such as your IP address and browser or device type so the service can run and stay secure. Murmur also creates a random first-party visitor ID in your browser and records page paths and visit timestamps when you open the site or move between app sections. This works even if you do not register or log in. The visitor ID is pseudonymous; Murmur does not use it to identify your real name and this visitor tracker does not collect your IP address, password, email address or device fingerprint. Authorized administrators can view visitor statistics and recent anonymous visit records for service analytics and improvement.</p>

    <h2>2. How we use your information</h2>
    <ul>
      <li>To create and manage your account and let you log in.</li>
      <li>To send emails you need, such as password reset links.</li>
      <li>To show your name, username and profile to other people as part of Murmur's features.</li>
      <li>To keep Murmur safe, prevent misuse and fix problems.</li>
      <li>To follow the law and respond to valid legal requests.</li>
    </ul>

    <h2>3. Who we share it with</h2>
    <p>We do not sell your personal information. We share it only with:</p>
    <ul>
      <li><strong>Service providers.</strong> Murmur uses Firebase Authentication for sign-in, Firebase Realtime Database for profiles and social features, and Firebase Storage for uploaded media. Murmur also uses Supabase to create and privately link a separate Supabase account ID to your Firebase account. These providers process information under their own terms and privacy policies.</li>
      <li><strong>Authorities or other parties</strong> when the law requires it, or to protect the rights and safety of you, others or Murmur.</li>
      <li><strong>A successor</strong> if Murmur is merged with, or sold to, another service. We would tell you first if your information would be handled under a different policy.</li>
    </ul>

    <h2>4. What other people can see</h2>
    <p>Your name, username and the posts you share are visible to other Murmur users. Think before you post personal details, and only share what you are comfortable with others seeing.</p>

    <h2>5. Where your information is stored</h2>
    <p>Account and social information is stored with Firebase, and a separate account-ID link is stored privately with Supabase. These providers may process information in data centers outside the country where you live. Review their privacy policies for details about their processing and international transfers.</p>

    <h2>6. How long we keep it</h2>
    <p>Information is retained while needed to operate your account and the service. Deletion requests should cover your Firebase account, related Realtime Database records and uploaded files, and the private account-ID link held in Supabase; some records may remain where retention is required by law or needed for security. Browser-stored preferences and cached state remain until cleared from your device.</p>

    <h2>7. Your choices and rights</h2>
    <p>Depending on where you live, you may have the right to:</p>
    <ul>
      <li>ask for a copy of the information we hold about you;</li>
      <li>correct information that is wrong or out of date;</li>
      <li>ask us to delete your account and information;</li>
      <li>object to or limit certain uses of your information.</li>
    </ul>
    <p>To use any of these rights, email <a href="mailto:${PRIVACY_CONTACT}">${PRIVACY_CONTACT}</a>. We may need to confirm it is really you first. You can also clear the data Murmur keeps in your browser at any time from your browser settings.</p>

    <h2>8. Security</h2>
    <p>We use trusted providers and reasonable safeguards to protect your information. No online service is completely secure, so please choose a strong, unique password and keep it private.</p>

    <h2>9. Children</h2>
    <p>Murmur is not for children under 13. We do not knowingly collect information from anyone under 13. If you believe a child has given us information, contact us and we will delete it.</p>

    <h2>10. Cookies and similar technologies</h2>
    <p>We use a small amount of browser storage to keep you signed in and remember your settings. Read the <a href="#cookies">Cookie Policy</a> for the details.</p>

    <h2>11. Changes to this policy</h2>
    <p>We may update this policy from time to time. When we make an important change we will update the date at the top and, where appropriate, let you know in the app.</p>

    <h2>12. Contact us</h2>
    <p>Questions about this policy or your information? Email <a href="mailto:${PRIVACY_CONTACT}">${PRIVACY_CONTACT}</a>.</p>
  `,

  cookies: () => `
    <h1>Cookie Policy</h1>
    <p class="legal-meta">Last updated: ${POLICY_UPDATED}</p>
    <p>This policy explains how Murmur uses cookies and similar technologies, such as your browser's local storage, and what choices you have. It should be read together with our <a href="#privacy">Privacy Policy</a>.</p>

    <h2>1. What are cookies and similar technologies?</h2>
    <p>Cookies are small text files a website can save in your browser. Similar technologies, like local storage and IndexedDB, also let a website save small pieces of information on your device so it can remember you between visits.</p>

    <h2>2. What Murmur uses</h2>
    <p>Murmur only uses storage that is strictly necessary to run the service. That is why it does not ask you to switch anything on or off.</p>
    <div class="legal-table-wrap">
      <table class="legal-table">
        <thead><tr><th>Name</th><th>Type</th><th>What it does</th><th>How long</th></tr></thead>
        <tbody>
          <tr><td><code>murmur-state</code></td><td>Local storage</td><td>Keeps limited interface state and cached app data on this device; Firebase remains the shared source for account and social data.</td><td>Until cleared from your browser</td></tr>
          <tr><td><code>firebaseLocalStorageDb</code></td><td>IndexedDB (Firebase Authentication)</td><td>Keeps you signed in and keeps your login secure.</td><td>Until you log out or clear your browser data</td></tr>
          <tr><td><code>murmur-cookie-notice</code></td><td>Local storage</td><td>Remembers that you have seen the cookie notice so we do not show it every time.</td><td>Until you clear your browser data</td></tr>
        </tbody>
      </table>
    </div>

    <h2>3. What Murmur does not use</h2>
    <ul>
      <li>No advertising cookies.</li>
      <li>No cross-site tracking.</li>
      <li>No third-party analytics.</li>
    </ul>

    <h2>4. Third parties</h2>
    <p>Murmur uses Google Firebase to sign you in and store your profile. When your browser connects to Google services it may receive technical information such as your IP address. Google's own privacy policy explains how it handles that information.</p>

    <h2>5. Managing storage</h2>
    <p>You can delete or block cookies and site data in your browser settings. If you do, you will be logged out and Murmur may forget your settings. Blocking storage completely may stop you from logging in, because the service needs it to keep you signed in.</p>

    <h2>6. Changes</h2>
    <p>If we ever add cookies or tools that are not strictly necessary, we will update this policy and ask for your permission first where the law requires it.</p>

    <h2>7. Contact</h2>
    <p>Questions? Email <a href="mailto:${PRIVACY_CONTACT}">${PRIVACY_CONTACT}</a>.</p>

    <h2>Show the cookie notice again</h2>
    <button type="button" class="btn secondary" data-reset-cookie-notice>Show cookie notice again</button>
  `
};

let legalOverlay = null;
let legalDirect = false;

function closeLegal(fromHash) {
  if (!legalOverlay) return;
  legalOverlay.remove();
  legalOverlay = null;
  const stillLocked = registerOverlay || forgotOverlay;
  if (!stillLocked) document.body.style.overflow = '';
  if (fromHash) return;
  if (legalDirect) {
    history.replaceState(null, '', '/' + location.search);
    legalDirect = false;
  } else if (LEGAL_HASHES[location.hash]) {
    history.back();
  }
}

function openLegal(page, direct) {
  if (!LEGAL_PAGES[page]) return;
  if (!legalOverlay) {
    legalDirect = !!direct;
    const overlay = document.createElement('div');
    legalOverlay = overlay;
    document.body.style.overflow = 'hidden';
    overlay.className = 'screen-legal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Privacy and cookies');
    overlay.innerHTML = `
      <div class="legal-top">
        <div class="brand-row"><span class="brand-mark" aria-hidden="true"></span><span>Murmur</span></div>
        <nav class="legal-tabs" role="tablist" aria-label="Legal pages">
          <button type="button" class="legal-tab" role="tab" data-legal-tab="terms">Terms</button>
          <button type="button" class="legal-tab" role="tab" data-legal-tab="privacy">Privacy Policy</button>
          <button type="button" class="legal-tab" role="tab" data-legal-tab="cookies">Cookie Policy</button>
        </nav>
        <button class="close-btn" type="button" aria-label="Close">×</button>
      </div>
      <div class="legal-body" data-legal-body><article class="legal-doc" data-legal-doc></article></div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelectorAll('[data-legal-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.legalTab;
        history.replaceState(null, '', '#' + target);
        renderLegal(target);
      });
    });
    overlay.querySelector('.close-btn').addEventListener('click', () => closeLegal(false));
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') closeLegal(false); });
    overlay.addEventListener('click', e => {
      if (e.target.closest('[data-reset-cookie-notice]')) {
        try { localStorage.removeItem(COOKIE_NOTICE_KEY); } catch {}
        showCookieNotice();
        showToast('Cookie notice will show again.');
      }
    });
    overlay.querySelector('.close-btn').focus();
  }
  renderLegal(page);
}

function renderLegal(page) {
  if (!legalOverlay || !LEGAL_PAGES[page]) return;
  legalOverlay.querySelectorAll('[data-legal-tab]').forEach(tab => {
    const on = tab.dataset.legalTab === page;
    tab.classList.toggle('active', on);
    tab.setAttribute('aria-selected', String(on));
  });
  legalOverlay.querySelector('[data-legal-doc]').innerHTML = LEGAL_PAGES[page]();
  legalOverlay.querySelector('[data-legal-body]').scrollTop = 0;
}

function showCookieNotice() {
  if (document.querySelector('.cookie-notice')) return;
  const box = document.createElement('div');
  box.className = 'cookie-notice';
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', 'Cookie notice');
  box.innerHTML = `
    <div>
      <strong>${ic('cookie')}We use cookies</strong>
      <p>Murmur only uses essential cookies and browser storage to keep you signed in and remember your settings. We don't use advertising or tracking cookies. See our <a href="#cookies">Cookie Policy</a> and <a href="#privacy">Privacy Policy</a>.</p>
    </div>
    <div class="cookie-actions">
      <button type="button" class="btn primary" data-cookie-ok>Got it</button>
      <button type="button" class="btn ghost" data-cookie-more>Learn more</button>
    </div>
  `;
  document.body.appendChild(box);
  box.querySelector('[data-cookie-ok]').addEventListener('click', () => {
    try { localStorage.setItem(COOKIE_NOTICE_KEY, 'seen'); } catch {}
    box.remove();
  });
  box.querySelector('[data-cookie-more]').addEventListener('click', () => {
    location.hash = '#cookies';
  });
}

function maybeShowCookieNotice() {
  let seen = false;
  try { seen = localStorage.getItem(COOKIE_NOTICE_KEY) === 'seen'; } catch {}
  if (!seen) showCookieNotice();
}

let profileOverlay = null;
function closeProfile(fromHash) {
  if (!profileOverlay) return;
  profileOverlay.remove(); profileOverlay = null;
  if (!fromHash && location.hash === '#profile') history.back();
}
let profileUid = null, profileTab = 'all', profileData = null;
const offlineBar = Object.assign(document.createElement('div'), { id: 'offlineBar', hidden: true, textContent: 'You are offline. Messages and posts will not send until you reconnect.' });
offlineBar.setAttribute('role', 'status');
document.body.appendChild(offlineBar);
const syncOnline = () => { offlineBar.hidden = navigator.onLine; };
window.addEventListener('online', syncOnline); window.addEventListener('offline', syncOnline); syncOnline();



// Support direct legal URLs (/terms, /privacy, /cookies) and in-app hash links.
function syncLegalLocation() {
  const pathPages = { '/terms': 'terms', '/privacy': 'privacy', '/cookies': 'cookies' };
  const page = LEGAL_HASHES[location.hash] || pathPages[location.pathname];
  if (page) {
    openLegal(page, !location.hash);
  } else if (legalOverlay) {
    closeLegal(true);
  }
}
window.addEventListener('hashchange', syncLegalLocation);
syncLegalLocation();
