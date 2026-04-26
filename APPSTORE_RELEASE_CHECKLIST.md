# Buril Lab App Store Release Checklist

## 1. Build Preparation

- Confirm `.env` contains `VITE_PUBLIC_APP_URL` or `VITE_INTERNAL_API_BASE_URL`.
- Confirm Cloudflare Pages has all server secrets from `.env.example`.
- Run:

```powershell
npm run lint
npm run test
npm run build
npm run assets:capacitor
npm run build:ios
```

- On Mac, run `npm run ios:open`, configure signing, then Archive in Xcode.

## 2. App Store Connect Metadata

- App name: `Buril Lab`
- Bundle ID: `com.burillab.app`
- Category: Productivity or Utilities
- Privacy Policy URL: `https://your-app.example.com/privacy`
- Support URL: `https://your-app.example.com/privacy` or a dedicated support page
- Support email: `gudwns999999@gmail.com`
- Provide demo credentials if App Review cannot create an account safely.

## 3. Privacy Nutrition Labels

Review and disclose the app's actual data use in App Store Connect:

- Contact Info: email address
- User Content: lab records, reagent inventory, notes, uploaded cabinet photos, feedback
- Identifiers: Supabase user ID
- Diagnostics or Other Usage Data: user agent and API abuse-prevention metadata where applicable
- Audio Data: voice questions if the voice assistant is enabled
- Search History: reagent search history

Mark data as linked to the user when it is stored with the user's account. Do not mark data as used for tracking unless a future integration shares data across apps or websites for advertising or tracking.

## 4. App Review Notes

- Explain that the app is for laboratory reagent inventory and safety workflow management.
- Mention that camera access is used for reagent label scanning and cabinet photos.
- Mention that microphone access is used only when the user opens the voice assistant.
- Mention that account deletion is available in Settings > Delete Account.
- Mention that shared lab inventory records may remain for collaborators after account deletion, with the deleted user's attribution removed.

## 5. TestFlight Checks

- Install through TestFlight on at least one real iPhone.
- Test camera permission denial and approval.
- Test microphone permission denial and approval.
- Test photo picker upload.
- Test login persistence after app restart.
- Test account deletion with a disposable account.
- Test API calls over cellular and Wi-Fi.

## 6. Submission Gates

- No server secrets appear in `dist/`, `ios/App/App/public/`, or Android assets.
- `/privacy` is reachable from a public URL.
- All screenshots match the current app UI.
- The uploaded build uses Xcode 26 or newer.
- TestFlight build has no crash reports from smoke testing.
