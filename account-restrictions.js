/* Shared account restriction reason catalogue for Murmur and Admin. */
(function (root) {
  'use strict';
  root.MURMUR_ACCOUNT_REASONS = Object.freeze([
    {id:'spam',icon:'📨',label:'Spam or repeated unwanted activity'},
    {id:'harassment',icon:'🛑',label:'Harassment or bullying'},
    {id:'hate',icon:'🚫',label:'Hateful or abusive content'},
    {id:'impersonation',icon:'🎭',label:'Impersonation or fake identity'},
    {id:'scam',icon:'⚠️',label:'Scams, fraud, or deception'},
    {id:'unsafe',icon:'🧨',label:'Threats or dangerous content'},
    {id:'privacy',icon:'🔒',label:'Sharing private information'},
    {id:'sexual',icon:'🔞',label:'Sexual or inappropriate content'},
    {id:'copyright',icon:'©️',label:'Copyright or intellectual-property violation'},
    {id:'other',icon:'📝',label:'Other policy violation'}
  ]);
  root.MurmurRestrictionTools = Object.freeze({
    reasonLabel: function (id) { return (root.MURMUR_ACCOUNT_REASONS.find(function (x) { return x.id === id; }) || root.MURMUR_ACCOUNT_REASONS[9]).label; },
    remaining: function (expiresAt, now) { return Math.max(0, Number(expiresAt || 0) - (now || Date.now())); }
  });
})(typeof window !== 'undefined' ? window : globalThis);
