# 3D Wall Achievement

Standalone Three.js experience for the Iyalagi.Manjat community.

## Project structure

```text
.
├── index.html              # Page structure and external asset references
├── assets/
│   ├── css/
│   │   └── styles.css      # Page and interface styles
│   └── js/
│       └── app.js          # Three.js scene, interactions and Supabase integration
└── README.md
```

## Deployment

This is a static site. Vercel should use the repository root as the project root and does not require a build command or output directory override. The production entry point is `index.html`.

## External runtime dependencies

- Tailwind CSS CDN
- Three.js r128 (CDN fallback list is configured in `assets/js/app.js`)
- Supabase JS v2 (CDN fallback list is configured in `assets/js/app.js`)

The Supabase publishable key is intended for browser use. Database access must remain protected by Row Level Security and server-side RPC validation. Never put a Supabase service-role key in frontend code.

## Refactor note

The initial structural refactor separates markup, styles and application logic while preserving the existing IIFE and runtime behavior. The JavaScript is intentionally kept together in this first pass because its state and functions are tightly coupled. Further extraction into scene, marker, Supabase and camera modules should be done with behavior tests for each module.
