# Raj Kuthir Owner (Android)

The owner's phone app for Sobuj Potro: confirm guest payments, answer
enquiries on WhatsApp, block nights, and change settings. It talks to the same
API as the web console (`/api/...` on rajkuthirhomestays.casa) and shares its
client, `lib/admin-client`.

- **Sign-in:** the admin password once; the server returns a token for this
  phone (`POST /api/admin/app/login`), kept in the Android keystore
  (expo-secure-store). Every launch, and after 5 minutes in the background,
  the app asks for the fingerprint / screen lock. Sensitive changes (WhatsApp
  mode, signing another phone out) ask again.
- **Screens:** Today (payments to check, with the screenshot; holds; activity),
  Enquiries (follow-up in your own WhatsApp; "dates are taken" message when
  they are), Calendar (upcoming, block / free nights, sync), Settings
  (WhatsApp manual / Business API, email alerts, signed-in phones).
- Not in this version: push notifications (need a Firebase project for
  Android), the guest ID documents, money / ledger. The web console still
  does all of those.

## Build an APK

This folder is an Expo (SDK 57) project with its own `npm install`; it is
left out of the pnpm workspace.

```bash
cd artifacts/owner-app
npm install
npx expo prebuild -p android          # generates android/ (not committed)
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
# then sign with the release key (kept privately by the owner, never in git):
zipalign -p -f 4 app/build/outputs/apk/release/app-release.apk aligned.apk
apksigner sign --ks rajkuthir-owner-release.jks --ks-key-alias rajkuthir-owner \
  --out RajKuthirOwner.apk aligned.apk
```

Bump `expo.android.versionCode` in `app.json` for every new APK, and always
sign with the same key, or Android will not install the update over the old app.
