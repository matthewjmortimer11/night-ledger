# Night Ledger

Night Ledger is a shared night-out planner, drink ledger, pub bingo board, Guinness split scorecard, and replay timeline.

## Local use

~~~bash
npm install
npm run dev
~~~

Open `http://127.0.0.1:8124`.

## Vercel

The production app uses a private Vercel Blob store for accounts and shared group ledgers. Create and connect a private Blob store to the Vercel project so `BLOB_READ_WRITE_TOKEN` is available to the deployed API, then deploy:

~~~bash
vercel --prod
~~~

## Notes

- Passwords are salted and hashed with Node `scrypt`.
- Auth sessions are stored server-side in the private Blob database.
- Group writes use Blob ETags and retry on concurrent edits.
