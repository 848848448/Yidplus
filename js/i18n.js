// Lightweight i18n. t('English string') returns the translation for the current
// language, or the English string itself if there's no entry. Translating a
// screen is just a matter of wrapping its strings in t() and adding entries here.
(function () {
  var DICT = {
    he: {
      'Home': 'בית', 'Chat': "צ'אט", 'Channels': 'ערוצים', 'Explore': 'גלה',
      'Settings': 'הגדרות', 'Profile': 'פרופיל', 'Search': 'חיפוש', 'Save': 'שמור',
      'Cancel': 'ביטול', 'Delete': 'מחק', 'Edit': 'ערוך', 'Back': 'חזור',
      'Change': 'שנה', 'View': 'הצג', 'Manage': 'נהל', 'Export': 'ייצא',
      'Message...': 'הודעה...', 'Send': 'שלח', 'Reply': 'השב', 'Forward': 'העבר',
      'Appearance': 'מראה', 'Color Theme': 'ערכת צבעים', 'Stats': 'סטטיסטיקה',
      'Privacy': 'פרטיות', 'Notifications': 'התראות', 'Security': 'אבטחה',
      'Help & About': 'עזרה ואודות', 'More': 'עוד', 'Verification': 'אימות',
      'Dark Mode': 'מצב כהה', 'Text Size': 'גודל טקסט',
      'Private Account': 'חשבון פרטי', 'Follow Requests': 'בקשות מעקב',
      'Active status': 'סטטוס פעיל', 'Read receipts': 'אישורי קריאה',
      'Blocked users': 'משתמשים חסומים', 'Chat wallpaper': "טפט צ'אט",
      'Muted chats': "צ'אטים מושתקים", 'Change Password': 'שנה סיסמה',
      'Two-factor authentication': 'אימות דו-שלבי',
      'Help & Support': 'עזרה ותמיכה', 'Send Feedback': 'שלח משוב',
      'Clear cache': 'נקה מטמון', 'About YID PLUS': 'אודות YID PLUS',
      'Download my data': 'הורד את הנתונים שלי', 'Admin Panel': 'פאנל ניהול',
      'Edit Profile': 'ערוך פרופיל', 'Sign Out': 'התנתק',
      'Who can see my profile': 'מי יכול לראות את הפרופיל שלי', 'Who can message me': 'מי יכול לשלוח לי הודעה',
    },
  };

  window.YP_LANG = (function () { try { var lang = localStorage.getItem('yp_lang') || 'en'; if (lang !== 'en' && lang !== 'he') { lang = 'en'; localStorage.setItem('yp_lang', lang); } return lang; } catch (e) { return 'en'; } })();

  window.t = function (s) {
    var lang = window.YP_LANG || 'en';
    if (lang === 'en' || !DICT[lang]) return s;
    return DICT[lang][s] || s;
  };

  window.setLang = function (lang) {
    if (lang !== 'en' && lang !== 'he') lang = 'en';
    try { localStorage.setItem('yp_lang', lang); } catch (e) {}
    window.YP_LANG = lang;
    location.reload();
  };
})();
