// Lightweight i18n. t('English string') returns the translation for the current
// language, or the English string itself if there's no entry. Translating a
// screen is just a matter of wrapping its strings in t() and adding entries here.
(function () {
  var DICT = {
    yi: {
      // Nav / common
      'Home': 'היים', 'Chat': 'טשאט', 'Channels': 'קאנאלן', 'Explore': 'אנטדעקן',
      'Settings': 'איינשטעלונגען', 'Profile': 'פּראפֿיל', 'Search': 'זוכן', 'Save': 'שפּייכערן',
      'Cancel': 'אָפּזאגן', 'Delete': 'אויסמעקן', 'Edit': 'רעדאַקטירן', 'Back': 'צוריק',
      'Change': 'טוישן', 'View': 'זען', 'Manage': 'פֿארוואלטן', 'Export': 'עקספּארטירן',
      'Message...': 'מעלדונג...', 'Send': 'שיקן', 'Reply': 'ענטפֿערן', 'Forward': 'פֿאָרווערטס',
      // Settings sections
      'Appearance': 'אויסזען', 'Color Theme': 'קאליר-טעמע', 'Stats': 'סטאטיסטיק',
      'Privacy': 'פּריוואטקייט', 'Notifications': 'מעלדונגען', 'Security': 'זיכערהייט',
      'Help & About': 'הילף & וועגן', 'More': 'מער', 'Verification': 'באשטעטיגונג',
      // Settings rows
      'Dark Mode': 'טונקעלער מאָדוס', 'Text Size': 'טעקסט-גרייס',
      'Private Account': 'פּריוואטער קאָנטע', 'Follow Requests': 'פֿאלג-בקשות',
      'Active status': 'אקטיווער סטאטוס', 'Read receipts': 'געלייענט-קבלות',
      'Blocked users': 'געבלאקטע יוזערס', 'Chat wallpaper': 'טשאט-הינטערגרונט',
      'Muted chats': 'געשטילטע טשאטס', 'Change Password': 'טוישן פּאַסווארט',
      'Two-factor authentication': 'צוויי-שריט באשטעטיגונג',
      'Help & Support': 'הילף & שטיצע', 'Send Feedback': 'שיקן אָפּרוף',
      'Clear cache': 'רייניגן קעש', 'About YID PLUS': 'וועגן YID PLUS',
      'Download my data': 'אַראָפּלאָדן מיינע דאטן', 'Admin Panel': 'אַדמין-פּאַנעל',
      'Edit Profile': 'רעדאַקטירן פּראפֿיל', 'Sign Out': 'אַרויסלאָגן',
      'Who can see my profile': 'ווער קען זען מיין פּראפֿיל', 'Who can message me': 'ווער קען מיר שיקן',
    },
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

  window.YP_LANG = (function () { try { return localStorage.getItem('yp_lang') || 'en'; } catch (e) { return 'en'; } })();

  window.t = function (s) {
    var lang = window.YP_LANG || 'en';
    if (lang === 'en' || !DICT[lang]) return s;
    return DICT[lang][s] || s;
  };

  window.setLang = function (lang) {
    try { localStorage.setItem('yp_lang', lang); } catch (e) {}
    window.YP_LANG = lang;
    location.reload();
  };
})();
