# YID PLUS — טעלעגראַם־סינק (Cloudflare Worker)

דער Worker לייענט דײַנע פּובליקע טעלעגראַם־טשענעלס **דורך דײַן אייגענעם אַקאַונט**
(MTProto), און שיקט נײַע פּאָסטן צו yidplus.com. ער לויפֿט **יעדע מינוט** אויף
Cloudflare — **קיין VPS, קיין געלט, קיין קרעדיט־קאַרטל, קיין קאָמפּיוטער.**

> **וויכטיק:** דאָס איז אַ **באַזונדער** Worker. ער רירט **נישט אָן** yidplus.com.
> אויב עפּעס אַרבעט נישט דאָ — די וועבזײַט בלײַבט גאַנץ.

**אַלץ טוט מען פֿון דעם טעלעפֿאָן־בראָוזער.** קיין טערמינאַל נישט נייטיק.

---

## שריט 1 — טעלעגראַם API־קיי

1. גיי צו **https://my.telegram.org** → לאָגירן מיט דײַן נומער
2. דריק **"API development tools"**
3. שאַף אַן אַפּ (סתּם אַ נאָמען, למשל `yidplus`)
4. **קאָפּיר די צוויי:** `api_id` (אַ נומער) און `api_hash` (אַ לאַנגער טעקסט)

## שריט 2 — מאַך אַ KV (וווּ די session וועט ליגן)

אין Cloudflare dashboard:
**Storage & Databases → KV → Create a namespace**
- נאָמען: `TG_SESSION`
- **קאָפּיר די ID** וואָס עס גיט דיר

דעמאָלט מוז די ID אַרײַן אין `wrangler.toml` (אויפֿן אָרט פֿון `PASTE_YOUR_KV_NAMESPACE_ID_HERE`).
מ'קען עס רעדאַגירן גלײַך אויף GitHub פֿון טעלעפֿאָן (דער ✏️ קנעפּל).

## שריט 3 — שאַף דעם Worker פֿון GitHub

אין Cloudflare dashboard:
**Workers & Pages → Create → Workers → Import a repository**

- **Repository:** `848848448/Yidplus`
- **Worker name:** `yidplus-telegram-worker`
  ⚠️ מוז זײַן **פּונקט** דער נאָמען (ער מוז גלײַכן צו `wrangler.toml`, אַנדערש פֿאַלט דער בילד)
- **Root directory:** `telegram-worker`
- **Build command:** `npm install`
- **Deploy command:** `npx wrangler deploy`

## שריט 4 — די סודות

אין דעם נײַעם Worker: **Settings → Variables and Secrets** → לייג צו ווי **Secret**:

| נאָמען | ווערט |
|---|---|
| `TELEGRAM_API_ID` | פֿון שריט 1 |
| `TELEGRAM_API_HASH` | פֿון שריט 1 |
| `TELEGRAM_INGEST_SECRET` | טראַכט אויס עפּעס לאַנג |
| `WORKER_ADMIN_SECRET` | נאָך אַ פּאַראָל (פֿאַר די לינקס אונטן) |

**דער זעלבער** `TELEGRAM_INGEST_SECRET` מוז **אויך** זײַן אין **Pages** (דײַן וועבזײַט):
Workers & Pages → דײַן Pages פּראָיעקט → Settings → Environment variables → זעלבער נאָמען, **זעלבע ווערט**.

## שריט 5 — לאָגירן (איין מאָל, פֿון טעלעפֿאָן)

דער Worker גיט דיר אַ URL, למשל `https://yidplus-telegram-worker.<דײַנס>.workers.dev`

עפֿן די לינקס אין דײַן בראָוזער (בײַט `SECRET` מיט דײַן `WORKER_ADMIN_SECRET`):

```
1.  .../login?phone=+1XXXXXXXXXX&secret=SECRET
    → טעלעגראַם שיקט דיר אַ קאָד

2.  .../code?code=12345&secret=SECRET
    → פֿאַרטיק!  (מיט two-step? עס וועט דיר זאָגן צו נוצן /password)

3.  .../status?secret=SECRET
    → זאָל זאָגן  logged_in: true
```

## שריט 6 — פּרוּוו

```
.../sync?secret=SECRET
```

דאָס לויפֿט אַ סינק **תּיכּף** און ווײַזט וויפֿל פּאָסטן זײַנען געשיקט געוואָרן.
דעמאָלט: YID PLUS → Channels → די פּאָסטן זאָלן זײַן דאָרט.

פֿון דעמאָלט אָן לויפֿט עס **אַליין יעדע מינוט**.

---

## אָנמערקונגען

- **טשענעלס:** לייג זיי צו אין דעם אַדמין־פּאַנעל (Channels → Telegram channels).
  דער Worker לייענט די רשימה פֿון דאָרט — קיין קאָד־טוישן נישט נייטיק.
- **נאָר פּובליקע טשענעלס** (מיט אַ `@username`). פּריוואַטע (`t.me/+...`) גייען נישט.
- **מעדיע:** די ערשטע ווערסיע שיקט **טעקסט + אַ לינק**. בילדער/ווידעאָס דאַרפֿן
  נאָך אַ שטיק אַרבעט (`upload.getFile`), וואָס מען קען צולייגן שפּעטער.
- **דײַן אַקאַונט:** ס'לויפֿט אויף דײַן טעלעגראַם־אַקאַונט. נוץ אים נאָרמאַל.
