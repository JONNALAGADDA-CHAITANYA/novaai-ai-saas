# NovaAI — AI-Powered SaaS Full-Stack Project

A beginner-friendly but properly structured full-stack AI SaaS application using:

- Node.js + Express
- MySQL
- OpenAI Responses API
- JWT authentication
- bcrypt password hashing
- Vanilla HTML/CSS/JavaScript frontend
- Conversation history
- Monthly usage tracking
- Free/Pro plan architecture
- Rate limiting
- Environment variables for secrets

## 1. Prerequisites

Install:

1. Node.js LTS
2. MySQL 8.x
3. A MySQL client such as MySQL Workbench
4. An OpenAI API key

Check Node:

```powershell
node -v
npm -v
npx -v
```

## 2. Open the project

In PowerShell:

```powershell
cd "$HOME\ai-saas-fullstack"
```

## 3. Install packages

```powershell
npm install
```

## 4. Create the MySQL database

Open MySQL Workbench.

Create a new SQL tab.

Open/copy `database.sql` and run the complete script.

It creates:

- `ai_saas`
- `users`
- `conversations`
- `messages`
- `usage_monthly`

## 5. Create `.env`

Copy:

```text
.env.example
```

and rename the copy to:

```text
.env
```

Then edit it.

Example:

```env
PORT=5000
CLIENT_URL=http://localhost:5000

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=YOUR_MYSQL_PASSWORD
DB_NAME=ai_saas

JWT_SECRET=make_this_a_long_random_secret

OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-5.6-luna

FREE_MONTHLY_LIMIT=50
```

Never put your OpenAI key inside `public/app.js` or any frontend file.

## 6. Start the application

Development mode:

```powershell
npm run dev
```

Or normal mode:

```powershell
npm start
```

You should see:

```text
AI SaaS running at http://localhost:5000
```

Open:

```text
http://localhost:5000
```

## 7. First test

Create an account.

Then:

1. Create a new chat.
2. Ask: `Explain REST APIs in simple terms.`
3. Wait for the AI response.
4. Refresh the page.
5. Login again.
6. Confirm the conversation remains in MySQL.

Health check:

```text
http://localhost:5000/api/health
```

It should report the database as connected and AI as configured.

## 8. Project structure

```text
ai-saas-fullstack/
│
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
│
├── database.sql
├── server.js
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

## 9. Important security notes

This project is suitable as a college/demo project and a foundation for a real SaaS product, but production deployment needs additional hardening.

Before production, add:

- HTTPS
- Secure, HttpOnly cookies instead of localStorage JWT
- CSRF protection if cookie auth is used
- Stronger request validation
- Account email verification
- Password reset
- Audit logging
- Real billing with Stripe or another provider
- Webhook verification
- Database backups
- Monitoring
- Secret management
- Production CORS configuration
- More granular AI quotas/cost controls

## 10. AI architecture

Frontend:

```text
Browser
  ↓
POST /api/chat
  ↓
Express authentication
  ↓
MySQL conversation/history
  ↓
OpenAI Responses API
  ↓
Save assistant response
  ↓
Browser
```

The OpenAI API key stays on the server.

## 11. Common errors

### `npm.ps1 cannot be loaded`

Run:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

Then:

```powershell
npm -v
```

### MySQL access denied

Check:

```env
DB_USER=root
DB_PASSWORD=your_actual_mysql_password
```

### Database does not exist

Run `database.sql` in MySQL Workbench.

### AI key missing

Make sure `.env` exists beside `server.js` and contains:

```env
OPENAI_API_KEY=...
```

Restart the Node server after changing `.env`.

### `OPENAI_API_KEY is not configured`

The server started, but the key was not loaded. Check `.env`, spelling, and restart.

### Port already in use

Change:

```env
PORT=5001
```

and open:

```text
http://localhost:5001
```

## 12. GitHub

Before pushing:

```powershell
git init
git add .
git commit -m "Initial AI SaaS application"
```

Do NOT commit `.env`.

The `.gitignore` already excludes it.

Then create an empty GitHub repository and connect it using the GitHub commands provided by GitHub.
