# 3D Wall Achievement

Standalone Three.js experience for the Iyalagi.Manjat community.

## Project structure

```text
.
├── index.html
├── assets/
│   ├── css/
│   │   └── styles.css
│   └── js/
│       ├── app.js               # Bootstrap, scene geometry and environment
│       ├── camera-controls.js   # Orbit, pan, pinch and keyboard controls
│       ├── markers.js           # 3D paw markers, previews and clustering
│       ├── supabase.js          # Anonymous auth, database and Realtime
│       └── utils.js             # UUID, date formatting and seeded RNG
└── README.md
```

## Deployment

Static site. Configure Vercel with the repository root as the project root. No build command or output directory override is required; the entry point is `index.html`.

## Runtime dependencies

- Tailwind CSS CDN
- Three.js r128 (CDN fallback list is configured in the application)
- Supabase JS v2 (CDN fallback list is configured in the application)

The browser uses a Supabase publishable key. Database access must remain protected by Row Level Security and server-side RPC validation. Never put a Supabase service-role key in frontend code.

## Architecture notes

The application entry point is loaded as an ES module. Feature factories receive shared mutable state through explicit getter/setter objects. Supabase and camera controls are separated from the main application shell, and marker rendering/clustering is isolated in its own module.

The scene geometry, environment and living 3D characters remain in `app.js` for now because they are tightly coupled to the original scene construction. Extracting them should be a separate behavior-tested step.
