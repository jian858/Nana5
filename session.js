/* =====================================================================
   SESSION  -  everything that starts when someone logs in and stops when they log out
   ===================================================================== */
function startSession(user) {
  startPostsListener(); startFriendsListener(user.uid); startExtras(user.uid); startReelsListener(user.uid);
  ensureProfile(user);
}
function endSession() {
  hideAppSkeleton();
  stopPostsListener(); stopFriendsListener(); stopExtras(); stopReelsListener();
  stopNoteListeners();
  accountCreatedAt = 0;
}

/* =====================================================================
   SKELETON SCREENS  -  grey shimmering shapes shown while data loads, so the screen never looks empty
   skelRows(3) = list rows, skelReel() = a full reel. Used by Reels and the comments sheet.
   ===================================================================== */
const skelRows = n => Array.from({ length: n }, () => '<div class="skel-row"><i class="skel round"></i><div><i class="skel line"></i><i class="skel line short"></i></div></div>').join('');
const skelReel = () => '<div class="reel skel-reel" aria-hidden="true"><div class="skel-phone"><i class="skel round"></i><i class="skel line"></i><i class="skel block"></i><i class="skel line short"></i></div></div>';

