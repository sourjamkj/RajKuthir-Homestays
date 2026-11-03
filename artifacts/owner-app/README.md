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
- **Screens:** Today (payments to check, with the screenshot; holds),
  Guests (the web console's Guests page: Enquiries with quotes, holds, the
  advance and booking; Bookings with check-in readiness, guest ID documents,
  verification / check-in / review WhatsApp, management handoff, invoices and
  OTA documents; the Guest list with opt-outs), Calendar (month grid, block /
  free nights, sync), Caretaker, Settings (WhatsApp manual / Business API,
  email alerts, signed-in phones).
- **Notifications:** the bell in the header is the web console's bell — what
  happened since you last marked it read (`/api/admin/activity`), with Mark
  all read shared with the web. There is no separate notifications screen.
  Tapping an item opens the enquiry or stay in Guests.
- **Files** (invoices, confirmations, OTA vouchers, ID documents) download
  with the app's token into its private cache and open in Android's share
  sheet (expo-file-system, expo-sharing).
- Not in this version: money / ledger (Earnings), rates, reviews. The web
  console still does those.

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
