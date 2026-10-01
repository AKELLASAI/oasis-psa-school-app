OASIS ANDROID APP (version 2.7) — the Oasis app built in

Oasis.apk contains the whole Oasis app. It runs on the phone by itself: no server, no Mac and
no Wi-Fi are needed, and it never asks for a server address. It opens straight to the login screen,
which shows "Oasis Android app 2.7 · works without internet". Records are kept on that phone only.

IF THE APP ASKS FOR A SERVER ADDRESS
  That is an old version (1.x). Uninstall it (press and hold the Oasis icon > App info > Uninstall),
  then install this Oasis.apk. If Android says "App not installed", uninstall the old one first too.

INSTALL ON A PHONE
  1. Copy Oasis.apk to the phone (WhatsApp it to yourself, Google Drive, a USB cable), or, while the
     Mac server is running, open  http://<the Mac's Wi-Fi address>:8080/Oasis.apk  in Chrome on the phone
     (the address is shown in the Oasis server window, for example http://192.168.0.3:8080).
  2. Tap it. Allow installing from that app when Android asks. If Play Protect warns about an
     unknown app, choose "Install anyway" (it is your own app).
  3. Open "Oasis" and log in with an administrator's email or username and password.
     It installs over earlier versions of the Oasis app.

MOVING RECORDS
  - Each phone has its own records. Entries made on one phone do not appear on other phones or the Mac.
  - To copy records onto the phone: on the Mac (or another phone) go to School Profile & Branding >
    Download backup, send the .db file to the phone, then in the app choose School Profile & Branding >
    Restore from backup. Everyone then logs in with the same passwords as on the Mac.
  - Take a backup regularly (it is saved in Downloads/Oasis). Uninstalling the app or clearing its
    data erases the records on that phone.

INTERNET
  Everything works offline, including the UPI QR code, except the map and the Google Sheet tab.

KEEP THESE SAFE (needed to publish updates of the app)
  source/keystore/oasis-release.keystore and source/keystore/password.key
  Android only installs an update if it is signed with the same key. Do not share them.

REBUILDING (for a developer)
  source/assets/www holds the built-in copy of the web app. After changing the web app, copy the
  changed files there, raise android:versionCode in source/AndroidManifest.xml, and run
  source/build.sh on Ubuntu with the packages:
  android-sdk-platform-23 aapt apksigner zipalign dalvik-exchange (and a JDK).
