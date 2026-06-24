# Buril Lab iOS Deployment Guide

This app is a Vite + React web app packaged with Capacitor. Windows can prepare and sync the iOS project, but App Store builds must run on macOS with Xcode. This repository uses GitHub Actions `macos-26` runners and fastlane so no rented or personal Mac is required.

## 1. Apple Account Setup

- Join the Apple Developer Program.
- Make sure your Apple account has Account Holder or Admin access in App Store Connect.
- Create the App Store Connect app record:
  - App name: `Buril Lab`
  - Bundle ID: `com.burillab.app`
  - Platform: iOS
- Create an App Store Connect API Team Key from Users and Access > Integrations > App Store Connect API.
- Save the API key ID, issuer ID, and downloaded `.p8` file. The `.p8` file cannot be downloaded again.

## 2. GitHub Secrets

Add these required secrets to the `haengjoo123/buril-lab` repository:

- `APPLE_TEAM_ID`: Apple Developer Team ID
- `APP_STORE_CONNECT_KEY_ID`: API key ID
- `APP_STORE_CONNECT_ISSUER_ID`: API issuer ID
- `APP_STORE_CONNECT_KEY_CONTENT_BASE64`: base64-encoded `.p8` file
- `MATCH_GIT_URL`: private signing repo URL, for example `https://github.com/haengjoo123/buril-lab-ios-signing.git`
- `MATCH_PASSWORD`: encryption password for fastlane match
- `MATCH_GIT_BASIC_AUTHORIZATION`: base64 of `github-username:personal-access-token` for the private signing repo

Optional secrets:

- `APP_STORE_CONNECT_TEAM_ID`: App Store Connect team ID, only needed if the account has multiple teams
- `TESTFLIGHT_EXTERNAL_GROUP`: external tester group name, defaults to `External Testers`
- `TESTFLIGHT_NOTIFY_EXTERNAL_TESTERS`: `true` or `false`, defaults to `true` for external beta
- `BETA_REVIEW_CONTACT_EMAIL`
- `BETA_REVIEW_CONTACT_FIRST_NAME`
- `BETA_REVIEW_CONTACT_LAST_NAME`
- `BETA_REVIEW_CONTACT_PHONE`
- `BETA_DEMO_ACCOUNT_NAME`
- `BETA_DEMO_ACCOUNT_PASSWORD`
- `BETA_REVIEW_NOTES`
- `BETA_PRIVACY_POLICY_URL`
- `BETA_MARKETING_URL`
- `BETA_DESCRIPTION`

PowerShell helper for the `.p8` secret:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("AuthKey_XXXXXXXXXX.p8"))
```

## 3. Signing Repository

Create a separate private GitHub repository named `haengjoo123/buril-lab-ios-signing`.

The first GitHub Actions run should set `bootstrap_signing` to `true`. That lets `fastlane match` create or repair the Apple Distribution certificate and App Store provisioning profile in the encrypted signing repo. After the first successful signing run, keep `bootstrap_signing` set to `false` for normal releases.

The signing repo must stay private. Do not commit certificates, provisioning profiles, `.p8` files, or match passwords to this app repository.

## 4. Local Preparation on Windows

Run these checks before triggering TestFlight:

```powershell
npm install
npm run lint
npm run test
npm run build
npm run assets:capacitor
npm run build:ios
```

`npm run build:ios` can sync web assets into the generated iOS project on Windows. Commands such as `npm run ios:open` and `npm run ios:run` still require macOS/Xcode and are not part of this Windows-first release flow.

## 5. TestFlight Workflow

Open GitHub > Actions > iOS TestFlight > Run workflow.

Inputs:

- `bootstrap_signing`: use `true` only for the first signing setup or when repairing signing assets.
- `marketing_version`: public app version, for example `1.0.0`.
- `changelog`: TestFlight "What to Test" text.
- `external_beta`: use `false` for the first internal TestFlight upload; use `true` after internal smoke testing to submit/distribute to the external group.

The workflow uses:

- `macos-26` GitHub-hosted runner
- Node.js 22
- Ruby 3.3 with Bundler cache
- fastlane `2.236.0`
- Xcode 26 when available on the runner

## 6. Required Functional Checks

- Sign up, sign in, sign out, and session restore
- Reagent search and Cloudflare Functions API calls
- Camera label scan
- Cabinet photo capture and upload to Supabase Storage
- Voice assistant recording and transcription when audio is enabled
- Privacy policy at `/privacy`
- Account deletion from Settings
- Shared lab data remains usable after a member deletes their account

## 7. Platform Boundary

This Windows workspace can validate npm scripts, web builds, Capacitor sync, static files, and secret exposure. App Store archive, signing, and TestFlight upload happen in GitHub Actions on macOS.
