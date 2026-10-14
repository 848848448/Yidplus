# YID PLUS Android hybrid

Public HTML/CSS/JS assets are bundled by `python3 android/scripts/bundle.py`.
The app uses the HTTPS yidplus.com origin, with an allowlisted local asset
interceptor. API requests remain online and retain HttpOnly session cookies.
No private chats or media are included in the bundle.

Google sign-in runs in the external browser. The return code expires after
2 minutes, is consumed once, and requires the installation's random verifier.
FCM uses the existing Shorts project's Android app and a dedicated sender role.
Server secret name: FCM_SERVICE_ACCOUNT_JSON. Never put it in this repo.

Build: Java 17, Android SDK 34, Gradle 8.5. Run assembleRelease and lintRelease.
Sign only with the established release key recovered from the secure vault.
No signing material is stored in the project or CI.

Runtime tests still required on a physical Android phone:
- in-place update from 1.1.0 and launch without Chrome
- email/Google sign-in, existing account 2FA, logout
- notification permission, token refresh, notification tap and logout cleanup
- MP3 Save As success, cancel, failure and content integrity
- file upload, camera/microphone permission and calls
- offline public shell with no private content cached
