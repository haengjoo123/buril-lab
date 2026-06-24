# Buril Lab App Store Release Checklist

## 1. Account and App Record

- Apple Developer Program membership is active.
- App Store Connect role is Account Holder or Admin.
- App record exists for `Buril Lab`.
- Bundle ID is `com.burillab.app`.
- Category is Productivity or Utilities.
- Privacy Policy URL points to the deployed `/privacy` page.
- Support URL points to `/privacy` or a dedicated support page.
- Support email is `gudwns999999@gmail.com`.
- Demo credentials are available if App Review cannot safely create an account.

## 2. GitHub Actions Setup

- Private signing repo exists: `haengjoo123/buril-lab-ios-signing`.
- Required GitHub secrets are configured:
  - `APPLE_TEAM_ID`
  - `APP_STORE_CONNECT_KEY_ID`
  - `APP_STORE_CONNECT_ISSUER_ID`
  - `APP_STORE_CONNECT_KEY_CONTENT_BASE64`
  - `MATCH_GIT_URL`
  - `MATCH_PASSWORD`
  - `MATCH_GIT_BASIC_AUTHORIZATION`
- External TestFlight secrets are configured before `external_beta` is set to `true`:
  - `BETA_REVIEW_CONTACT_EMAIL`
  - `BETA_REVIEW_CONTACT_FIRST_NAME`
  - `BETA_REVIEW_CONTACT_LAST_NAME`
  - `BETA_REVIEW_CONTACT_PHONE`
  - `BETA_PRIVACY_POLICY_URL`
- Optional external secrets are reviewed:
  - `TESTFLIGHT_EXTERNAL_GROUP`
  - `TESTFLIGHT_NOTIFY_EXTERNAL_TESTERS`
  - `BETA_DEMO_ACCOUNT_NAME`
  - `BETA_DEMO_ACCOUNT_PASSWORD`
  - `BETA_REVIEW_NOTES`
  - `BETA_MARKETING_URL`
  - `BETA_DESCRIPTION`

## 3. Local Build Preparation

Confirm `.env` contains `VITE_PUBLIC_APP_URL` or `VITE_INTERNAL_API_BASE_URL`, plus Supabase client values.

Confirm Cloudflare Pages has all server secrets from `.env.example`. Do not expose server secrets as `VITE_*` variables.

Run on Windows:

```powershell
npm run lint
npm run test
npm run build
npm run assets:capacitor
npm run build:ios
```

## 4. First TestFlight Upload

- In GitHub Actions, run `iOS TestFlight` with:
  - `bootstrap_signing`: `true`
  - `marketing_version`: current release version, for example `1.0.0`
  - `changelog`: concise "What to Test" text
  - `external_beta`: `false`
- Confirm the workflow uses Xcode 26 or newer.
- Confirm the build appears in App Store Connect > TestFlight.
- Install through internal TestFlight on at least one real iPhone.

After the first successful signing run, use `bootstrap_signing: false` for normal releases.

## 5. Internal TestFlight Checks

- Sign up, sign in, sign out, and session restore.
- Test camera permission denial and approval.
- Test microphone permission denial and approval.
- Test photo picker upload.
- Test login persistence after app restart.
- Test account deletion with a disposable account.
- Test reagent search and Cloudflare API calls over cellular and Wi-Fi.
- Confirm `/privacy` is reachable from the production URL.

## 6. External TestFlight

- Create or confirm the external tester group in App Store Connect. Default expected name: `External Testers`.
- Configure Beta App Review contact and privacy URL secrets.
- Run `iOS TestFlight` with:
  - `bootstrap_signing`: `false`
  - `external_beta`: `true`
- Confirm Beta App Review is submitted or approved.
- Confirm external testers can install by invite or public link.

## 7. Privacy Nutrition Labels

Review and disclose the app's actual data use in App Store Connect:

- Contact Info: email address
- User Content: lab records, reagent inventory, notes, uploaded cabinet photos, feedback
- Identifiers: Supabase user ID
- Diagnostics or Other Usage Data: user agent and API abuse-prevention metadata where applicable
- Audio Data: voice questions if the voice assistant is enabled
- Search History: reagent search history

Mark data as linked to the user when it is stored with the user's account. Do not mark data as used for tracking unless a future integration shares data across apps or websites for advertising or tracking.

## 8. App Review Notes

- Explain that the app is for laboratory reagent inventory and safety workflow management.
- Mention that camera access is used for reagent label scanning and cabinet photos.
- Mention that microphone access is used only when the user opens the voice assistant.
- Mention that account deletion is available in Settings > Delete Account.
- Mention that shared lab inventory records may remain for collaborators after account deletion, with the deleted user's attribution removed.

## 9. Submission Gates

- No server secrets appear in `dist/`, `ios/App/App/public/`, or Android assets.
- `/privacy` is reachable from a public URL.
- All screenshots match the current app UI.
- The uploaded build uses Xcode 26 or newer.
- TestFlight build has no crash reports from smoke testing.
