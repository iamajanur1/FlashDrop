# FlashDrop frontend

React 19 + Vite + Tailwind frontend for FlashDrop v2.

## Development

```bash
cp .env.example .env
npm install
npm run dev
```

`VITE_BACKEND_URL` should point to the FastAPI origin, for example `http://localhost:8000`.
For migration compatibility, `REACT_APP_BACKEND_URL` is also exposed by the Vite config.

## Build

```bash
npm run build
npm run preview
```

The transfer UI intentionally uses browser-native attachment downloads instead of fetching large responses into JavaScript memory.
