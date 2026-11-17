/* Shared account restriction reason catalogue for Murmur and Admin. */
(function (root) {
  "use strict";

  const reasons = [
    { id: "spam", icon: "📨", label: "Spam or repeated unwanted activity" },
    { id: "harassment", icon: "🛑", label: "Harassment or bullying" },
    { id: "hate", icon: "🚫", label: "Hateful or abusive content" },
    { id: "impersonation", icon: "🎭", label: "Impersonation or fake identity" },
    { id: "scam", icon: "⚠️", label: "Scams, fraud, or deception" },
    { id: "unsafe", icon: "🧨", label: "Threats or dangerous content" },
    { id: "privacy", icon: "🔒", label: "Sharing private information" },
    { id: "sexual", icon: "🔞", label: "Sexual or inappropriate content" },
    { id: "copyright", icon: "©️", label: "Copyright or intellectual-property violation" },
    { id: "other", icon: "📝", label: "Other policy violation" }
  ];

  root.MURMUR_ACCOUNT_REASONS = Object.freeze(reasons);

  root.MurmurRestrictionTools = Object.freeze({
    reasonLabel(id) {
      const reason = reasons.find(item => item.id === id);
      return (reason || reasons[reasons.length - 1]).label;
    },

    remaining(expiresAt, now = Date.now()) {
      return Math.max(0, Number(expiresAt || 0) - now);
    }
  });
})(typeof window !== "undefined" ? window : globalThis);
