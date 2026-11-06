# Third-party notices

The Apache-2.0 license at the repository root applies only to material the
repository owner has the right to license. Third-party software, services,
fonts, icons, maps, protocols, screenshots of third-party UI, and other assets
retain their own copyright and license terms.

## Dependency inventories

The versioned dependency manifests and lockfiles are the authoritative software
inventory:

- Web: [web/package.json](web/package.json) and
  [web/package-lock.json](web/package-lock.json)
- Server: [server/package.json](server/package.json) and
  [server/package-lock.json](server/package-lock.json)
- Android: [mobile-kotlin/app/build.gradle.kts](mobile-kotlin/app/build.gradle.kts),
  [mobile-kotlin/build.gradle.kts](mobile-kotlin/build.gradle.kts), and the
  resolved Gradle dependency graph produced by `./gradlew app:dependencies`

Major third-party families include React, Vite, TypeScript, Socket.IO, Firebase,
Leaflet, Express, Azure Storage SDK, SQLite, bcrypt, Sharp, Jetpack Compose,
Hilt, Google Play Services, osmdroid, OkHttp, WebRTC, Tink, Coil, and Kotlin
coroutines. This summary is not a substitute for their package-level license
files and notices.

### Direct web packages at the reviewed lockfile

| Package family | Resolved version | Declared package license |
|---|---:|---|
| React / React DOM | 18.3.1 | MIT |
| React Router DOM | 7.10.1 | MIT |
| React Icons | 5.5.0 | MIT |
| React Leaflet | 4.2.1 | Hippocratic-2.1 |
| Leaflet | 1.9.4 | BSD-2-Clause |
| Firebase JavaScript SDK | 12.10.0 | Apache-2.0 |
| Socket.IO client | 4.7.5 | MIT |
| TypeScript | 5.6.3 | Apache-2.0 |
| Vite / React plugin | 7.3.1 / 5.1.1 | MIT |
| Vitest | 4.0.18 | MIT |
| React/DOM/Leaflet type packages | lockfile versions | MIT |

### Direct server packages at the reviewed lockfile

| Package family | Resolved version | Declared package license |
|---|---:|---|
| Azure Storage Blob SDK | 12.31.0 | MIT |
| bcryptjs | 3.0.3 | BSD-3-Clause |
| better-sqlite3 | 12.6.2 | MIT |
| Cheerio | 1.2.0 | MIT |
| CORS / Express / Helmet / Multer | lockfile versions | MIT |
| express-rate-limit | 8.3.1 | MIT |
| Firebase Admin SDK | 13.6.1 | Apache-2.0 |
| Sharp | 0.33.5 | Apache-2.0 |
| Socket.IO server | 4.8.1 | MIT |
| uuid | 9.0.1 | MIT |
| Vitest | 3.2.4 | MIT |

### Direct Android dependency families

| Family | License/terms to preserve |
|---|---|
| AndroidX and Jetpack Compose | Apache-2.0 |
| Dagger/Hilt | Apache-2.0 |
| Firebase Android SDK | Package-level Firebase/Google open-source notices |
| Google Sign-In and Play Services Location | Google APIs/SDK terms plus package notices |
| Tink, OkHttp, Kotlin coroutines, Coil, Gson | Apache-2.0 |
| osmdroid | Apache-2.0; map/tile data attribution is separate |
| Socket.IO Java client | MIT |
| WebRTC Android artifact | Upstream WebRTC/artifact notices, including BSD-style terms |
| JUnit 4 | Eclipse Public License 1.0 |

Before binary distribution, generate and retain the resolved Gradle license
inventory rather than relying only on this family-level summary.

## Hosted services and standards

Azure, Firebase, GitHub, OpenStreetMap tile providers, and any TURN/DNS/TLS
provider are governed by their own terms. WebRTC and related protocols are
standards rather than owner-authored repository content.

## Portfolio assets

- The architecture Mermaid source and rendered SVG are repository-authored.
- Screenshot files in `docs/assets/screenshots` are runtime captures described
  by [their provenance register](docs/assets/README.md).
- The owner-prepared capture package and pixel/privacy-mask policy are recorded
  in [fixtures/owner-prepared-v3.json](docs/assets/fixtures/owner-prepared-v3.json).
- No stock photo, third-party avatar, recorded human voice, or real face is
  approved for the current capture set.

## Redistribution review

Before publishing a new binary or media asset:

1. regenerate the resolved dependency/license inventory;
2. preserve dependency notices required by each license;
3. confirm every image, icon, font, map, sound, and sample file has documented
   redistribution rights;
4. record exceptions in this file and in the release evidence;
5. do not assume Apache-2.0 relicenses third-party material.
