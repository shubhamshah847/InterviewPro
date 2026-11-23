# InterviewPro

An AI-powered interview practice app built with React, Express, MongoDB, and Gemini. It includes email OTP account verification and password reset, reusable saved resumes, adjustable interview difficulty and duration, mock interviews, guided answer coaching, AI feedback, Gemini audio transcription, spoken responses, and an optional local camera preview.

The interview model uses Gemini Interactions with `gemini-3.5-flash-lite`; spoken replies use streaming `gemini-3.8-flash-lite-tts` so playback can begin as audio chunks arrive. Maya and Dev use `image_girl.png` and `image_boy.png` as their portraits while listening or when live video is unavailable. Dev has a warm, raspy, gravelly, lightly breathy male voice, while Maya provides a bright professional voice. Optional manually generated HeyGen MP4 clips can be shown while Gemini audio plays; these clips are muted and are not lip-synced to each answer. The interface shows when Gemini is generating a reply, when the audio stream is starting, and when audio is playing. English and Hindi/Hinglish interviews are supported, and coach selection does not change questions or scoring. Candidates can type or record an answer; voice answers are recorded by the browser and sent directly to Gemini for transcription and evaluation. Allow microphone access and keep an internet connection. Saved resumes retain extracted text and the filename, not the uploaded file. The optional camera preview is local to the browser.

Completed sessions track six answer skills: technical accuracy, communication clarity, answer structure, problem solving, role relevance, and language fluency. The dashboard shows recent session trends, and future questions use only the signed-in user's prior InterviewPro session scores, notes, and question topics to focus practice and avoid repeats. Guided practice provides a tailored 3-4 step answer framework and sample answer after each response; it uses only details from the candidate's answer or resume and marks missing details as placeholders rather than inventing experience. Mock interview mode remains a realistic interview with regular feedback and no sample answer.

## Requirements

- Node.js 20+
- MongoDB (local or hosted)
- A Gemini API key for AI-generated questions and feedback
- Resend API key for production email (the sender defaults to `no-reply@shubhamsah.com.np`)
- Redis is optional; when `REDIS_URI` is set, it stores shared auth rate limits across API instances.

## Run locally

1. Copy `backend/.env.example` to `backend/.env` and set `MONGO_URI`, `JWT_WEB_TOKEN` (a long random secret), and `GEMINI_API_KEY`.
2. Set `RESENDEMAIL_API_KEY` to your Resend key. The default sender uses your verified `shubhamsah.com.np` domain; set `EMAIL_FROM` if you want a different sender on that domain.
3. Optionally set `HEYGEN_API_KEY` for LiveAvatar video. Keep this key in the backend environment only. The free sandbox is enabled by default.
4. Optionally set `REDIS_URI` to a reachable Redis instance. Leave it blank to use in-memory rate limiting in a single development server.
5. At the project root, install all workspace dependencies:

   ```powershell
   npm install
   ```

6. Start frontend and backend together:

   ```powershell
   npm run all
   ```

7. Open `http://localhost:5173`. In development without Resend/SMTP credentials, OTPs are shown in the app and logged by the backend; they are never returned this way in production.

The API health check is at `http://localhost:5000/api/health`.

## Deploy the full app on Vercel

The repository is configured as one Vercel project: the frontend is built to `frontend/dist`, and Vercel function entry points under `api/` forward API requests to the shared Express app in `backend/app.js`, including nested auth and interview routes.

1. Import the repository into Vercel and set the project root directory to the repository root.
2. Keep the configured install command (`npm ci --include=optional`) and build command (`npm run build`); the output directory is `frontend/dist`.
3. Add the backend environment variables in Vercel Project Settings. Required: `MONGO_URI`, `JWT_WEB_TOKEN`, `GEMINI_API_KEY`, and `RESENDEMAIL_API_KEY` (or the SMTP settings). `REDIS_URI` and `HEYGEN_API_KEY` are optional.
4. Set `CLIENT_URL` to `https://useinterviewpro.vercel.app`. Leave `VITE_API_URL` unset or set it to `/api` so the frontend calls the API on the same domain.
5. Redeploy after setting environment variables. Store secrets only in Vercel Project Settings; `.env` files are excluded from Git and Vercel CLI uploads.

## LiveAvatar video

The interview screen fills the browser viewport while active to reduce distractions. It can connect LiveAvatar LITE to the existing Gemini TTS stream. Keep `HEYGEN_API_KEY` in the backend environment only; it is never sent to the browser. The default configuration uses LiveAvatar's free sandbox, which only provides the Wayne avatar and ends sessions after about one minute. To use your own avatars, set `LIVEAVATAR_SANDBOX=false`, then set `LIVEAVATAR_AVATAR_ID_GIRL` and `LIVEAVATAR_AVATAR_ID_BOY` to the corresponding avatar IDs in your LiveAvatar account; LITE usage consumes 1 credit per minute. The older `LIVEAVATAR_AVATAR_ID` remains a fallback when a matching ID is missing. The interview plays LiveAvatar's returned audio track with its video to keep speech and lip movement together; it stops the live session after each spoken turn and shows the selected coach portrait while the candidate responds, reducing billed idle time. It reconnects for the next spoken turn. If synchronized video cannot connect, Gemini TTS plays with the selected portrait. See [sandbox mode](https://docs.liveavatar.com/docs/sandbox-mode) and [LITE credits](https://docs.liveavatar.com/docs/lite-mode/overview).

## Practice modes

Choose **Mock interview** to rehearse a realistic interview and get concise feedback after each answer. Choose **Guided practice** to answer first, then receive actionable feedback, a tailored 3-4 step answer framework, and a sample response based on the provided answer and resume. Examples use placeholders for missing personal details; they are coaching aids, not scripts to memorize.

The selected **Beginner**, **Intermediate**, or **Advanced** difficulty is kept consistent across opening and follow-up questions. Answer quality can change the topic or angle of a follow-up, but does not silently raise or lower the selected level.

## Main API routes

- `POST /api/auth/register`, `/verify-otp`, `/resend-otp`, `/login`, `/forgot-password`, `/reset-password`; `PATCH /api/auth/profile`
- `GET /api/interviews`, `POST /api/interviews`
- `POST /api/interviews/speech` (authenticated, streamed TTS)
- `POST /api/interviews/:id/avatar/session`, `POST /api/interviews/:id/avatar/stop` (authenticated LiveAvatar lifecycle)
- `GET /api/interviews/resumes`, `POST /api/interviews/resumes` (authenticated resume library)
- `GET /api/interviews/:id`, `POST /api/interviews/:id/answer`, `POST /api/interviews/:id/finish`

Authenticated routes use `Authorization: Bearer <token>`. Resume uploads accept PDF, DOCX, and TXT (up to 5 MB). Microphone recording requires user permission and a working Gemini API key.
