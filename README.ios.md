# Buril Lab iOS Deployment Guide

This app is a Vite + React web app packaged with Capacitor. The iOS project is generated under `ios/`, but final simulator/device builds require macOS and Xcode.

## 1. Local Prerequisites

- Node.js and npm
- A complete `.env` based on `.env.example`
- `VITE_PUBLIC_APP_URL` or `VITE_INTERNAL_API_BASE_URL` pointing to the deployed Cloudflare Pages app
- Supabase client values in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`

Server secrets such as `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `GOOGLE_VISION_API_KEY`, `OPENAI_API_KEY`, and `KOSHA_API_KEY` must be configured in Cloudflare Pages Functions. Do not add them to `VITE_*` variables.

## 2. Prepare the iOS Project

```powershell
npm install
npm run assets:generate
npm run assets:capacitor
npm run build:ios
```

Useful commands:

```powershell
npm run ios:sync
npm run ios:open
npm run ios:run
```

`ios:open` and `ios:run` require macOS with Xcode. On Windows, `build:ios` can sync web assets into the generated iOS project, but it cannot launch the iOS Simulator.

## 3. Xcode Requirements

On a Mac:

- Install Xcode 26 or newer.
- Sign in with an Apple Developer Program account.
- Open the project with `npm run ios:open` or open `ios/App/App.xcodeproj`.
- Set the development team for the App target.
- Confirm the bundle identifier is `com.burillab.app`.
- Create an Archive and upload it to App Store Connect.

This project uses the Capacitor Swift Package Manager integration. A `Podfile` is not expected for this generated iOS project.

## 4. iOS Permissions

The app uses the following iOS permission descriptions in `ios/App/App/Info.plist`:

- Camera: scanning reagent labels and taking cabinet photos
- Microphone: voice assistant questions
- Photo Library: choosing existing label or cabinet photos

Before submitting, verify these prompts on a real iPhone or iOS Simulator.

## 5. Required Functional Checks

- Sign up, sign in, sign out, and session restore
- Reagent search and Cloudflare Functions API calls
- Camera label scan
- Cabinet photo capture and upload to Supabase Storage
- Voice assistant recording and transcription when audio is enabled
- Privacy policy at `/privacy`
- Account deletion from Settings
- Shared lab data remains usable after a member deletes their account

## 6. Known Platform Boundary

Codex on this Windows workspace can validate npm scripts, web builds, Capacitor sync, static files, and secret exposure. iOS Simulator runs, Xcode signing, Archive creation, and TestFlight upload must be done from a Mac.
