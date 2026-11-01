
/* Loads Firebase and hands its functions to the app code below. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, setPersistence, browserLocalPersistence, browserSessionPersistence, sendPasswordResetEmail, reauthenticateWithCredential, EmailAuthProvider, deleteUser, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getDatabase, ref, set, get, push, update, remove, onValue, query, orderByChild, equalTo, limitToLast, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';
window.__fb = { initializeApp, getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, setPersistence, browserLocalPersistence, browserSessionPersistence, sendPasswordResetEmail, reauthenticateWithCredential, EmailAuthProvider, deleteUser, signOut, onAuthStateChanged, getDatabase, ref, set, get, push, update, remove, onValue, query, orderByChild, equalTo, limitToLast, serverTimestamp, getStorage, storageRef, uploadBytesResumable, getDownloadURL, deleteObject };
