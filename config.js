
/* =====================================================================
   SETTINGS  -  THE PART YOU EDIT MOST
   Change limits, texts, timings and your Firebase keys here.
   Nothing else in the app needs to be touched for these.
   ===================================================================== */

/* Firebase project keys (the apiKey of a Firebase web app is meant to be public;
   protect your data with Firebase rules, not by hiding this). */
window.MURMUR_FIREBASE = {
  apiKey: 'AIzaSyBRjnlDgDmLRkVncPYx34eNdYMI48L7q1M',
  authDomain: 'murmur-fc430.firebaseapp.com',
  projectId: 'murmur-fc430',
  // If your Realtime Database URL is different, paste it here (Firebase console > Realtime Database).
  databaseURL: 'https://murmur-fc430-default-rtdb.firebaseio.com',
  storageBucket: 'murmur-fc430.firebasestorage.app',
  messagingSenderId: '174754264269',
  appId: '1:174754264269:web:986030ac0d85e698fb6584',
  measurementId: 'G-4VGXRWCJS8'
};

/* =====================================================================
   SETTINGS  (change numbers/text here, you don't need to touch the code)
   ===================================================================== */
window.MURMUR_CONFIG = {
  appName: 'Murmur',
  maxLength:   { message: 300, post: 200 },          // characters
  rateLimits:  {                                      // [tries, per how many milliseconds]
    login:   [5, 60000],
    message: [15, 20000],
    post:    [4, 60000]
  },
  onlineWindowMs: 180000,                             // friend counts as "Online" if seen in the last 3 minutes
  presenceRefreshMs: 60000,                           // how often the chat list re-checks who is online
  logoutAnimationMs: 650,                             // door animation length when logging out
  chatAnimMs: 260,                                    // chat slide in/out speed in ms
  blockAnimMs: 900,                                   // how long the STOP sign shows before the chat closes
  text: {
    online: 'Online',
    offline: 'Offline',
    typeMessage: 'Type a message\u2026',
    tooFastMessage: 'Slow down a little.',
    tooFastPost: 'You are posting too fast. Wait a minute.',
    blockTitle: 'Stop messages from {name}?',
    blockBody: 'They will disappear from your chats and you will not get their messages on this device. You can undo this in Menu > Blocked people.',
    chatLoadFailed: 'Could not load this chat. Check your connection.'
  }
};
