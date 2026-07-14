# YID PLUS — טעלעגראַם־סינק (Cloudflare Worker)

דער Worker לייענט דײַנע פּובליקע טעלעגראַם־טשענעלס **דורך דײַן אייגענעם אַקאַונט**
(MTProto), און שיקט נײַע פּאָסטן צו yidplus.com. ער לויפֿט **יעדע מינוט** אויף
Cloudflare — **קיין VPS, קיין געלט, קיין קרעדיט־קאַרטל**.

> **וויכטיק:** דאָס איז אַ **באַזונדער** Worker. ער רירט **נישט אָן** yidplus.com.
> אויב עפּעס אַרבעט נישט דאָ — די וועבזײַט בלײַבט גאַנץ.

---

## וואָס דו דאַרפֿסט

- אַ קאָמפּיוטער מיט Node.js (צום דעפּלויען, איין מאָל)
- דײַן טעלעגראַם־נומער (פֿאַרן קאָד)

## שריט 1 — טעלעגראַם API־קיי

1. גיי צו **https://my.telegram.org** → לאָגירן מיט דײַן נומער
2. דריק **"API development tools"** → שאַף אַן אַפּ (סתּם אַ נאָמען)
3. קאָפּיר: **api_id** און **api_hash**

## שריט 2 — דעפּלוי דעם Worker

אין אַ טערמינאַל, אין דעם `telegram-worker` פֿאָלדער:

```bash
npm install
npx wrangler login          # עפֿנט דעם בראָוזער, אַרײַנלאָזן דײַן Cloudflare
npx wrangler kv namespace create TG_SESSION
```

דאָס לעצטע דרוקט אויס אַן **id**. עפֿן `wrangler.toml` און לייג עס אַרײַן אויפֿן אָרט
פֿון `PASTE_YOUR_KV_NAMESPACE_ID_HERE`.

## שריט 3 — די סודות

```bash
npx wrangler secret put TELEGRAM_API_ID          # פֿון שריט 1
npx wrangler secret put TELEGRAM_API_HASH        # פֿון שריט 1
npx wrangler secret put TELEGRAM_INGEST_SECRET   # טראַכט אויס עפּעס לאַנג
npx wrangler secret put WORKER_ADMIN_SECRET      # נאָך אַ פּאַראָל, פֿאַר די /login לינקס
```

**דער זעלבער** `TELEGRAM_INGEST_SECRET` מוז אויך זײַן אין **Cloudflare Pages**
(דײַן וועבזײַט): Settings → Environment variables → זעלבער נאָמען, זעלבע ווערט.

## שריט 4 — אַרויף

```bash
npx wrangler deploy
```

עס דרוקט אויס אַ URL, למשל `https://yidplus-telegram-worker.<דײַנס>.workers.dev`

## שריט 5 — לאָגירן (איין מאָל)

עפֿן די דאָזיקע לינקס אין דײַן בראָוזער (בײַט אויס `SECRET` מיט דײַן `WORKER_ADMIN_SECRET`):

```
1.  .../login?phone=+1XXXXXXXXXX&secret=SECRET
    → טעלעגראַם שיקט דיר אַ קאָד

2.  .../code?code=12345&secret=SECRET
    → פֿאַרטיק! (אויב דו האָסט two-step, וועט עס דיר זאָגן צו נוצן /password)

3.  .../status?secret=SECRET
    → זאָל זאָגן  logged_in: true
```

## שריט 6 — פּרוּוו

```
.../sync?secret=SECRET
```

דאָס לויפֿט אַ סינק **תּיכּף** און ווײַזט וויפֿל פּאָסטן זײַנען געשיקט געוואָרן.
דעמאָלט גיי צו YID PLUS → Channels → דו זאָלסט זען די פּאָסטן.

פֿון דעמאָלט אָן לויפֿט עס **אַליין יעדע מינוט**.

---

## אָנמערקונגען

- **טשענעלס:** לייג זיי צו אין דעם אַדמין־פּאַנעל (Channels → Telegram channels).
  דער Worker לייענט די רשימה פֿון דאָרט — קיין קאָד־טוישן נישט נייטיק.
- **נאָר פּובליקע טשענעלס** (מיט אַ `@username`). פּריוואַטע (`t.me/+...`) גייען נישט.
- **מעדיע:** די ערשטע ווערסיע שיקט **טעקסט + אַ לינק**. בילדער/ווידעאָס דאַרפֿן
  נאָך אַ שטיק אַרבעט (`upload.getFile`), וואָס מען קען צולייגן שפּעטער.
- **דײַן אַקאַונט:** ס'לויפֿט אויף דײַן טעלעגראַם־אַקאַונט. נוץ אים נאָרמאַל.
- **לאָגס:** `npx wrangler tail` ווײַזט וואָס דער Worker טוט.
